/**
 * 書体の読み込み（設計 B-59b / ADR-074 結果3 / ADR-075）。
 *
 * 観るのは**置いたファイルどうしの整合**である — 書体の一覧 `public/fonts/fonts.css` の
 * `@font-face`、その `src` が指す woff2、各書体の `OFL.txt`、それを読む `index.html`。
 * Service Worker のキャッシュ（設計 6章 規則10〜12）は単体テストで観ない（同 8章）。
 *
 * 書体の名・太さ・件数・ファイル名は**原本から取り出した事実**であり、期待値は literal で置く。
 */

import { describe, expect, it } from 'vitest';
import {
  customPropertyOf,
  directoryOf,
  fileNameOf,
  fontFacesOf,
  fontsCss,
  globalCss,
  htmlTagsOf,
  indexHtml,
  oflTextByDirectory,
  resolveFromFontsDirectory,
  topLevelRulesOf,
  unquote,
  woff2Paths,
  woff2UrlOf,
} from '../support/fonts/FontFiles.js';

const inter = 'Inter';
const zenKakuGothicNew = 'Zen Kaku Gothic New';

const fontFaces = fontFacesOf(fontsCss);

function fontFacesFor(family: string, weight: string) {
  return fontFaces.filter((fontFace) => fontFace.family === family && fontFace.weight === weight);
}

/** `src` を `public/fonts/` から見たパスにする。1項の woff2 でなければ `src` をそのまま返す。 */
function resolvedPathOf(src: string): string {
  const url = woff2UrlOf(src);
  return url === null ? src : resolveFromFontsDirectory(url);
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

describe('書体の一覧 public/fonts/fonts.css', () => {
  it('書体と太さの組は Inter と Zen Kaku Gothic New の 400 と 500 の4組だけである', () => {
    const pairs = distinct(fontFaces.map(({ family, weight }) => `${family} ${weight}`)).sort();

    // ADR-074 結果3 / 設計 B-59b 6章 規則1: 2書体 × 2太さがちょうど揃う。
    expect(pairs).toEqual([
      'Inter 400',
      'Inter 500',
      'Zen Kaku Gothic New 400',
      'Zen Kaku Gothic New 500',
    ]);
  });

  it('斜体の書体を置かない', () => {
    // 設計 B-59b 6章 規則1: 全ブロック font-style: normal。
    expect(distinct(fontFaces.map((fontFace) => fontFace.style))).toEqual(['normal']);
  });

  it('書体の名は書体の並びの先頭2つと同じ名である', () => {
    const fontFamily = customPropertyOf(globalCss, '--font-family') ?? '';
    const leadingTwo = fontFamily.split(',').slice(0, 2).map(unquote).sort();

    // 設計 B-59b 6章 規則2: 名が一つでも違えば、読み込んだ書体が並びから使われない。
    expect(distinct(fontFaces.map((fontFace) => fontFace.family)).sort()).toEqual(leadingTwo);
  });

  it('一覧は 256 個の @font-face からなる', () => {
    // 設計 B-59b 6章 規則3: 原本の css2 応答のブロックをそのまま保つ。
    expect(fontFaces).toHaveLength(256);
  });

  it('書体を取りに行けない間は手元の書体で描く', () => {
    // FR-41 / ADR-016 / 設計 B-59b 6章 規則11・7章: font-display: swap で並びの3つ目以降に落ちる。
    expect(distinct(fontFaces.map((fontFace) => fontFace.display))).toEqual(['swap']);
  });

  it('各 src は同じディレクトリから辿る woff2 を1つだけ指す', () => {
    const offending = fontFaces
      .map((fontFace) => fontFace.src)
      .filter((src) => {
        const url = woff2UrlOf(src);
        return url === null || /^(https?:|\/)/.test(url);
      });

    // 設計 B-59b 6章 規則4・規則8: 第三者にも根からのパスにも向けない。
    expect(offending).toEqual([]);
  });

  it('src が指す woff2 はすべて置かれている', () => {
    const missing = fontFaces
      .map((fontFace) => resolvedPathOf(fontFace.src))
      .filter((path) => !woff2Paths.includes(path));

    // 設計 B-59b 6章 規則4: 指す先のファイルが public/fonts/ に必ず存在する。
    expect(missing).toEqual([]);
  });

  it('どの src からも指されない woff2 を置かない', () => {
    const referenced = fontFaces.map((fontFace) => resolvedPathOf(fontFace.src));

    // 設計 B-59b 6章 規則4: 使われないファイルを配らない。
    expect(woff2Paths.filter((path) => !referenced.includes(path))).toEqual([]);
  });

  it('Inter は 400 と 500 が同じ7つのファイルを指す', () => {
    const regular = fontFacesFor(inter, '400').map((fontFace) => resolvedPathOf(fontFace.src));
    const medium = fontFacesFor(inter, '500').map((fontFace) => resolvedPathOf(fontFace.src));

    // 設計 B-59b 6章 規則5: Inter は可変書体で、同じ中身を2つ置かない。
    expect(medium).toEqual(regular);
    expect(distinct(regular)).toHaveLength(7);
  });

  it('Zen Kaku Gothic New は太さごとに別の 121 ファイルを指す', () => {
    const regular = distinct(
      fontFacesFor(zenKakuGothicNew, '400').map((fontFace) => resolvedPathOf(fontFace.src)),
    );
    const medium = distinct(
      fontFacesFor(zenKakuGothicNew, '500').map((fontFace) => resolvedPathOf(fontFace.src)),
    );

    // 設計 B-59b 6章 規則5: Zen は太さごとに別ファイル（121 × 2）。
    expect({
      regular: regular.length,
      medium: medium.length,
      shared: regular.filter((path) => medium.includes(path)).length,
    }).toEqual({ regular: 121, medium: 121, shared: 0 });
  });

  it('書体のファイルは版の入ったディレクトリに置く', () => {
    const directoriesByFamily = {
      [inter]: distinct(
        fontFaces
          .filter((fontFace) => fontFace.family === inter)
          .map((fontFace) => directoryOf(resolvedPathOf(fontFace.src))),
      ),
      [zenKakuGothicNew]: distinct(
        fontFaces
          .filter((fontFace) => fontFace.family === zenKakuGothicNew)
          .map((fontFace) => directoryOf(resolvedPathOf(fontFace.src))),
      ),
    };

    // 設計 B-59b 6章 規則6 / 10章 前提1: CacheFirst は同じ URL に古い中身を返すため、
    // 差し替えは版を変えた新しいパスで行う。
    expect(directoriesByFamily).toEqual({
      [inter]: ['inter-4.001'],
      [zenKakuGothicNew]: ['zen-kaku-gothic-new-1.002'],
    });
  });

  it('直前に分割の名のコメントがあるブロックは、その名をファイル名にする', () => {
    const mismatched = fontFaces
      .filter((fontFace) => fontFace.precedingComment !== null)
      .map((fontFace) => ({
        expected:
          fontFace.family === inter
            ? `${fontFace.precedingComment}.woff2`
            : `${fontFace.weight}-${fontFace.precedingComment}.woff2`,
        actual: fileNameOf(resolvedPathOf(fontFace.src)),
      }))
      .filter(({ expected, actual }) => expected !== actual);

    // 設計 B-59b 6章 規則6: Inter は <subset>.woff2、Zen は <weight>-<subset>.woff2。
    expect(mismatched).toEqual([]);
  });

  it('コメントの無いブロックは、太さごとに出現順の3桁の番号をファイル名にする', () => {
    const summaries = Object.fromEntries(
      distinct(
        fontFaces
          .filter((fontFace) => fontFace.precedingComment === null)
          .map((fontFace) => `${fontFace.family} ${fontFace.weight}`),
      ).map((group) => {
        const names = fontFaces
          .filter(
            (fontFace) =>
              fontFace.precedingComment === null &&
              `${fontFace.family} ${fontFace.weight}` === group,
          )
          .map((fontFace) => fileNameOf(resolvedPathOf(fontFace.src)));
        return [
          group,
          {
            first: names[0],
            last: names[names.length - 1],
            count: names.length,
            // 3桁0詰めの名が出現順に昇順で、重複が無い — 端と件数と合わせて、途切れないことを読む。
            ascendingWithoutDuplicates: names.every(
              (name, index) => index === 0 || (names[index - 1] ?? '') < name,
            ),
          },
        ];
      }),
    );

    // 設計 B-59b 6章 規則6 / 10章 前提3: 番号はその書体・太さの中の出現順。コメントのある
    // 3つ（cyrillic / latin-ext / latin）は末尾にあるので、番号の無いブロックは 000〜117。
    expect(summaries).toEqual({
      'Zen Kaku Gothic New 400': {
        first: '400-000.woff2',
        last: '400-117.woff2',
        count: 118,
        ascendingWithoutDuplicates: true,
      },
      'Zen Kaku Gothic New 500': {
        first: '500-000.woff2',
        last: '500-117.woff2',
        count: 118,
        ascendingWithoutDuplicates: true,
      },
    });
  });

  it('書体の一覧には @font-face 以外の規則を書かない', () => {
    const others = topLevelRulesOf(fontsCss)
      .map((rule) => rule.prelude)
      .filter((prelude) => prelude !== '@font-face');

    // ADR-055 決定2 / 設計 B-59b 6章 規則9: トークンとリセットは global.css の1枚だけ。
    expect(others).toEqual([]);
  });
});

describe('index.html', () => {
  it('index.html は書体の一覧 /fonts/fonts.css を読む', () => {
    const links = htmlTagsOf(indexHtml)
      .filter((tag) => tag.name === 'link')
      .map((tag) => ({ rel: tag.attributes.get('rel'), href: tag.attributes.get('href') }));

    // 設計 B-59b 6章 規則8: 書体の一覧は <link> で読む。
    expect(links).toContainEqual({ rel: 'stylesheet', href: '/fonts/fonts.css' });
  });

  it('index.html は第三者の相手を href にも src にも書かない', () => {
    const thirdParty = htmlTagsOf(indexHtml)
      .flatMap((tag) => [tag.attributes.get('href'), tag.attributes.get('src')])
      .filter((value): value is string => value !== undefined)
      .filter((value) => /^(https?:|\/\/)/.test(value));

    // ADR-075 / 設計 B-59b 6章 規則8: 書体のための第三者への要求をどこにも書かない。
    expect(thirdParty).toEqual([]);
  });
});

describe('書体の OFL.txt', () => {
  it('書体のディレクトリにはどれも OFL.txt がある', () => {
    const directories = distinct(woff2Paths.map(directoryOf)).sort();

    // SIL OFL 1.1 の同梱条件 / 設計 B-59b 6章 規則7。
    expect(directories.filter((directory) => !oflTextByDirectory.has(directory))).toEqual([]);
    expect(directories).toHaveLength(2);
  });

  it.each([
    ['inter-4.001', 'Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)'],
    [
      'zen-kaku-gothic-new-1.002',
      'Copyright 2022 The Zen Project Authors (https://github.com/googlefonts/zen-kakugothic)',
    ],
  ])('OFL.txt の先頭行はその書体の著作権表示である（%s）', (directory, copyright) => {
    const firstLine = (oflTextByDirectory.get(directory) ?? '').split(/\r?\n/)[0];

    // 設計 B-59b 6章 規則7: 先頭に name 表の著作権表示を置く。
    expect(firstLine).toBe(copyright);
  });

  it.each(['inter-4.001', 'zen-kaku-gothic-new-1.002'])(
    'OFL.txt は SIL OFL 1.1 の全文を含む（%s）',
    (directory) => {
      const text = oflTextByDirectory.get(directory) ?? '';

      // 設計 B-59b 6章 規則7: 著作権表示に続けて SIL OFL 1.1 の全文を置く。
      expect(text).toContain('SIL OPEN FONT LICENSE');
      expect(text).toContain('Version 1.1 - 26 February 2007');
      expect(text).toContain('OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.');
    },
  );
});
