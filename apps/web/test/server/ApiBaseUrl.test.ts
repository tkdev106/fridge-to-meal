import { describe, expect, it } from 'vitest';
import { apiBaseUrlOf } from '../../src/server/ApiBaseUrl.js';

// 標本（`docs/testing.md` 6章）。anon key も記録に入れておく — 断りの message に
// **他の値を載せない**ことを見る1件（A9）が、載ったら気づける値を要るためである。
const baseUrl = 'https://api.example.dev';
const anonKey = 'anon-key-example';

/**
 * 揃った記録。本題でない欄を隠し、**本題の名前だけが `overrides` に現れる**形にする
 * （`docs/testing.md` 6章 / 先行 `SessionConfig.test.ts`）。
 */
function vars(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string | undefined> {
  return { VITE_API_BASE_URL: baseUrl, VITE_SUPABASE_ANON_KEY: anonKey, ...overrides };
}

/**
 * 名前を**キーごと**持たない記録。`import.meta.env` の実物は未設定の名前をキーごと持たず、
 * `undefined` を代入した形とは別物である（先行 `SessionConfig.test.ts` / B-34 設計 規則12）。
 */
function varsWithout(
  name: string,
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string | undefined> {
  const record = vars(overrides);
  delete record[name];
  return record;
}

/**
 * 投げられた例外そのものを取り出す。**中身を見るのは message を確かめる1件（A9）だけ**
 * （先行 `SessionConfig.test.ts`）。
 */
function caughtError(execution: () => unknown): Error {
  try {
    execution();
  } catch (thrown) {
    return thrown as Error;
  }
  throw new Error('例外が投げられなかった');
}

describe('API の基点 apiBaseUrlOf', () => {
  it('VITE_API_BASE_URL の値をそのまま基点として返す', () => {
    // B-22 設計 規則4・5: 読むのは渡された記録の1つだけで、正規化して写すだけ。
    expect(apiBaseUrlOf(vars())).toBe('https://api.example.dev');
  });

  it('前後の空白を落として返す', () => {
    // B-22 設計 規則5: URL の形をした設定の先行（`accessTokenVerificationOf`）に倣う。
    expect(apiBaseUrlOf(vars({ VITE_API_BASE_URL: '  https://api.example.dev  ' }))).toBe(
      'https://api.example.dev',
    );
  });

  it('末尾の / は連続していてもすべて落として返す', () => {
    // B-22 設計 規則5 / 規則6: 叩く先は `${baseUrl}/stock-items` なので、`/` が残ると二重になる。
    expect(apiBaseUrlOf(vars({ VITE_API_BASE_URL: 'https://api.example.dev///' }))).toBe(
      'https://api.example.dev',
    );
  });

  it('末尾の / が空白に囲まれていても落として返す', () => {
    // B-22 設計 規則5: 空白を落としたあとの末尾を見る（順序を取り違えると `/` が残る）。
    expect(apiBaseUrlOf(vars({ VITE_API_BASE_URL: '  https://api.example.dev/  ' }))).toBe(
      'https://api.example.dev',
    );
  });

  it('VITE_API_BASE_URL が未設定なら API_BASE_URL に値があっても基点を作らない', () => {
    // B-22 設計 規則4・5 / 7章1行目 / 先行 `sessionConfigOf` 規則11: `VITE_` の付かない名前は
    // サーバ専用で、同じ値が web に来ている保証がない。
    const withoutViteBaseUrl = varsWithout('VITE_API_BASE_URL', { API_BASE_URL: baseUrl });

    expect(() => apiBaseUrlOf(withoutViteBaseUrl)).toThrow(Error);
  });

  it('VITE_API_BASE_URL が空文字なら基点を作らない', () => {
    // B-22 設計 規則5 / 7章1行目: 空を通すと、欠けたことに気づかないまま相対の経路を叩きにいく。
    expect(() => apiBaseUrlOf(vars({ VITE_API_BASE_URL: '' }))).toThrow(Error);
  });

  it('VITE_API_BASE_URL が空白だけなら基点を作らない', () => {
    // B-22 設計 規則5: **先行 `sessionConfigOf` は空白を通すが、ここは通さない** —
    // こちらは正規化してから使う値であり、落とした結果が空になる。
    expect(() => apiBaseUrlOf(vars({ VITE_API_BASE_URL: '   ' }))).toThrow(Error);
  });

  it('VITE_API_BASE_URL が / だけなら基点を作らない', () => {
    // B-22 設計 規則5: 末尾の `/` を落とした結果が空。
    expect(() => apiBaseUrlOf(vars({ VITE_API_BASE_URL: '/' }))).toThrow(Error);
  });

  it('断るとき例外の message に記録の他の値を載せない', () => {
    // B-22 設計 規則5 / 7章1行目 / ADR-045 結果2: message は名前までにする。
    // **断ったこと自体を先に断定する** — そうしないと、別の理由で投げられた例外の message も
    // 値を含まないので、空振りで緑になる（先行 `SessionConfig.test.ts`）。
    const error = caughtError(() => apiBaseUrlOf(varsWithout('VITE_API_BASE_URL')));

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('anon-key-example');
  });

  it('断るとき例外の message に名前を出す', () => {
    // B-22 設計 規則5（「名前まで」の側）/ 10章 / ADR-045 結果2: この失敗は誰も包み直さず、
    // message がそのまま開発者の目に届く。**落ち方に名前が出ることで、足す値に気づける。**
    // 例外が `Error` であることを先に断定する（先行 `SessionConfig.test.ts`）。
    const error = caughtError(() => apiBaseUrlOf(varsWithout('VITE_API_BASE_URL')));

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('VITE_API_BASE_URL');
  });
});
