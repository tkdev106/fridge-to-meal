/**
 * 書体の一覧 `public/fonts/fonts.css` と、その周りのファイルを読み込む（設計 B-59b 8章）。
 *
 * 読み込みに `node:fs` ではなく vite（vitest）の `import.meta.glob` を使うのは、web にも
 * `@types/node` が無く（`tsconfig.test.json` の `types: []`）、依存を足すのはユーザーの承認が
 * 要るため（先行 `apps/api/test/support/migrations/MigrationFiles.ts`）。読むのはリポジトリ内の
 * ファイルで、`docs/testing.md` 5章がプロセス外の依存の禁止から外している範囲に収まる。
 *
 * **woff2 は中身を読まない。** 数えるのは glob のキー（パス）だけで、eager にもしない。
 */

/** `import.meta.glob` は vite が変換時に解決する。呼び出しは直書きでないと展開されない。 */
type GlobbableImportMeta = {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
  glob(pattern: string): Record<string, () => Promise<unknown>>;
};

const loadedFontsCss = (import.meta as unknown as GlobbableImportMeta).glob(
  '../../../public/fonts/fonts.css',
  { query: '?raw', import: 'default', eager: true },
);

const loadedGlobalCss = (import.meta as unknown as GlobbableImportMeta).glob(
  '../../../src/global.css',
  { query: '?raw', import: 'default', eager: true },
);

const loadedIndexHtml = (import.meta as unknown as GlobbableImportMeta).glob(
  '../../../index.html',
  { query: '?raw', import: 'default', eager: true },
);

const loadedOflTexts = (import.meta as unknown as GlobbableImportMeta).glob(
  '../../../public/fonts/*/OFL.txt',
  { query: '?raw', import: 'default', eager: true },
);

const loadedWoff2 = (import.meta as unknown as GlobbableImportMeta).glob(
  '../../../public/fonts/**/*.woff2',
);

/** glob のキーに付く `public/fonts/` までの前置き。 */
const fontsDirectoryPrefix = '../../../public/fonts/';

/**
 * 1つしか当たらない glob から全文を取り出す。**空なら投げる** — css は vitest の
 * `test.css.include` に当たらないと `?raw` でも空文字になり、そのまま読むと
 * 「規則が1つも無いので違反も無い」形で空振りの緑になるため。
 */
function soleContentOf(loaded: Record<string, string>, label: string): string {
  const contents = Object.values(loaded);
  const [content] = contents;
  if (contents.length !== 1 || content === undefined || content === '') {
    throw new Error(`${label} を読めていない（当たった件数 ${contents.length}）`);
  }
  return content;
}

/** `public/fonts/fonts.css` の全文。 */
export const fontsCss: string = soleContentOf(loadedFontsCss, 'public/fonts/fonts.css');

/** `src/global.css` の全文。 */
export const globalCss: string = soleContentOf(loadedGlobalCss, 'src/global.css');

/** `index.html` の全文。 */
export const indexHtml: string = soleContentOf(loadedIndexHtml, 'index.html');

/** `public/fonts/` から見たディレクトリ名 → `OFL.txt` の全文。 */
export const oflTextByDirectory: ReadonlyMap<string, string> = new Map(
  Object.entries(loadedOflTexts).map(([path, content]): [string, string] => [
    directoryOf(path.slice(fontsDirectoryPrefix.length)),
    content,
  ]),
);

/** `public/fonts/` から見た woff2 のパスの一覧（`inter-4.001/latin.woff2` の形）。並びは決定的。 */
export const woff2Paths: readonly string[] = Object.keys(loadedWoff2)
  .map((path) => path.slice(fontsDirectoryPrefix.length))
  .sort();

/** パスのディレクトリの部分（最後の `/` より前）。無ければ空文字。 */
export function directoryOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/** パスのファイル名の部分（最後の `/` より後）。 */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** `public/fonts/` を起点に相対パスを解決する（`.` と `..` を畳む）。外へ出たら `..` が残る。 */
export function resolveFromFontsDirectory(relativePath: string): string {
  const segments: string[] = [];
  for (const segment of relativePath.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..' && segments.length > 0 && segments[segments.length - 1] !== '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

/** css の最上位の規則1つ。`@font-face { … }` も `@import …;` も `:root { … }` もこの形で出る。 */
export type TopLevelRule = {
  /** `{` または `;` より前（前後の空白を落とす）。 */
  prelude: string;
  /** 直前の最上位の要素がコメントなら、その中身（前後の空白を落とす）。でなければ `null`。 */
  precedingComment: string | null;
  /** 宣言の名 → 値（値の中の連続する空白は1つに畳む）。`;` で終わる規則では空。 */
  declarations: ReadonlyMap<string, string>;
};

/**
 * css を最上位の規則に切り分ける。**コメントは規則に数えず**、直後の規則の
 * `precedingComment` にだけ残す（分割の名のコメント。設計 B-59b 6章 規則6）。
 */
export function topLevelRulesOf(css: string): TopLevelRule[] {
  const rules: TopLevelRule[] = [];
  let precedingComment: string | null = null;
  let index = 0;
  while (index < css.length) {
    if (/\s/.test(css.charAt(index))) {
      index += 1;
      continue;
    }
    if (css.startsWith('/*', index)) {
      const end = css.indexOf('*/', index + 2);
      const stop = end === -1 ? css.length : end;
      precedingComment = css.slice(index + 2, stop).trim();
      index = stop + 2;
      continue;
    }
    const braceAt = css.indexOf('{', index);
    const semicolonAt = css.indexOf(';', index);
    if (semicolonAt !== -1 && (braceAt === -1 || semicolonAt < braceAt)) {
      rules.push({
        prelude: css.slice(index, semicolonAt).trim(),
        precedingComment,
        declarations: new Map(),
      });
      precedingComment = null;
      index = semicolonAt + 1;
      continue;
    }
    if (braceAt === -1) {
      rules.push({ prelude: css.slice(index).trim(), precedingComment, declarations: new Map() });
      break;
    }
    const bodyEnd = closingBraceOf(css, braceAt);
    rules.push({
      prelude: css.slice(index, braceAt).trim(),
      precedingComment,
      declarations: declarationsOf(css.slice(braceAt + 1, bodyEnd)),
    });
    precedingComment = null;
    index = bodyEnd + 1;
  }
  return rules;
}

/** `{` に対応する `}` の位置。入れ子を数える。閉じていなければ末尾。 */
function closingBraceOf(css: string, openAt: number): number {
  let depth = 0;
  for (let index = openAt; index < css.length; index += 1) {
    const character = css.charAt(index);
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return css.length;
}

function declarationsOf(body: string): ReadonlyMap<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const colonAt = declaration.indexOf(':');
    if (colonAt === -1) continue;
    const name = declaration.slice(0, colonAt).trim();
    const value = declaration
      .slice(colonAt + 1)
      .replace(/\s+/g, ' ')
      .trim();
    declarations.set(name, value);
  }
  return declarations;
}

/** `@font-face` のブロック1つ。宣言の値は css に書かれたまま（引用符も残す）。 */
export type FontFace = {
  /** 引用符を外した書体の名。 */
  family: string;
  weight: string;
  style: string;
  display: string;
  src: string;
  precedingComment: string | null;
};

/** 書体の一覧の `@font-face` を、書かれた順に取り出す。 */
export function fontFacesOf(css: string): FontFace[] {
  return topLevelRulesOf(css)
    .filter((rule) => rule.prelude === '@font-face')
    .map((rule) => ({
      family: unquote(rule.declarations.get('font-family') ?? ''),
      weight: rule.declarations.get('font-weight') ?? '',
      style: rule.declarations.get('font-style') ?? '',
      display: rule.declarations.get('font-display') ?? '',
      src: rule.declarations.get('src') ?? '',
      precedingComment: rule.precedingComment,
    }));
}

/** 前後の引用符（`'` か `"`）を1組外す。 */
export function unquote(value: string): string {
  const matched = /^(['"])(.*)\1$/.exec(value.trim());
  return matched?.[2] ?? value.trim();
}

/**
 * `src` が `url(<パス>) format('woff2')` の1項だけなら、そのパスを返す。でなければ `null`。
 * 引用符は `'` / `"` / 無しのどれでもよい。
 */
export function woff2UrlOf(src: string): string | null {
  const matched = /^url\((['"]?)([^'"()\s]+)\1\) format\((['"])woff2\3\)$/.exec(src.trim());
  return matched?.[2] ?? null;
}

/** css の中のカスタムプロパティ `--name` の値（最初に現れたもの）。無ければ `null`。 */
export function customPropertyOf(css: string, name: string): string | null {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const matched = new RegExp(`${name}\\s*:([^;]*);`).exec(withoutComments);
  return matched?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
}

/** html の開きタグ1つ。属性の名は小文字にそろえる。 */
export type HtmlTag = { name: string; attributes: ReadonlyMap<string, string> };

/** html の開きタグを、書かれた順に取り出す（コメントの中は見ない）。 */
export function htmlTagsOf(html: string): HtmlTag[] {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const tags: HtmlTag[] = [];
  for (const tag of withoutComments.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const attributes = new Map<string, string>();
    for (const attribute of (tag[2] ?? '').matchAll(
      /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
    )) {
      attributes.set(
        (attribute[1] ?? '').toLowerCase(),
        attribute[2] ?? attribute[3] ?? attribute[4] ?? '',
      );
    }
    tags.push({ name: (tag[1] ?? '').toLowerCase(), attributes });
  }
  return tags;
}
