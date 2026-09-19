import { describe, expect, it } from 'vitest';
import { sessionConfigOf } from '../../src/session/SessionConfig.js';

// 標本（`docs/testing.md` 6章）。url と anonKey は**互いに見分けのつく**文字列にする —
// 取り違えた実装が緑にならないため。
const url = 'https://example.supabase.co';
const anonKey = 'anon-key-example';

/**
 * 2つとも揃った記録。本題でない欄を隠し、**本題の名前だけが `overrides` に現れる**形にする
 * （`docs/testing.md` 6章）。
 */
function vars(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string | undefined> {
  return { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey, ...overrides };
}

/**
 * 名前を**キーごと**持たない記録。`import.meta.env` の実物は未設定の名前をキーごと持たず、
 * `undefined` を代入した形とは別物である（B-34 設計 規則12）。
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
 * 投げられた例外そのものを取り出す。**中身を見るのは message を確かめる2件だけ**
 * （先行 `apps/api/test/contexts/identity/infrastructure/HouseholdAuthenticatorImpl.test.ts`）。
 */
function caughtError(execution: () => unknown): Error {
  try {
    execution();
  } catch (thrown) {
    return thrown as Error;
  }
  throw new Error('例外が投げられなかった');
}

describe('セッションの設定 sessionConfigOf', () => {
  it('2つの名前に値があるときその値をそのまま持つ設定を返す', () => {
    // B-34 設計 5章 / 規則11 / ADR-046 決定4: 読むのは VITE_ の付いた2つだけで、値は写すだけ。
    const config = sessionConfigOf(vars());

    expect(config).toEqual({ url: 'https://example.supabase.co', anonKey: 'anon-key-example' });
  });

  it('VITE_SUPABASE_URL が未設定なら SUPABASE_URL に値があっても設定を作らない', () => {
    // B-34 設計 規則11・12 / 7章1行目 / ADR-046 結果2: VITE_ の付かない名前はサーバ専用で、読まない。
    const withoutViteUrl = varsWithout('VITE_SUPABASE_URL', { SUPABASE_URL: url });

    expect(() => sessionConfigOf(withoutViteUrl)).toThrow(Error);
  });

  it('VITE_SUPABASE_URL が空文字なら設定を作らない', () => {
    // B-34 設計 規則12 / 7章1行目 / ADR-043 決定3: 空を通すと欠けたことに気づけない。
    expect(() => sessionConfigOf(vars({ VITE_SUPABASE_URL: '' }))).toThrow(Error);
  });

  it('VITE_SUPABASE_ANON_KEY が未設定なら SUPABASE_ANON_KEY に値があっても設定を作らない', () => {
    // B-34 設計 規則11・12 / 7章1行目 / ADR-046 結果2: 鍵の側も同じく VITE_ の付いた名前だけを読む。
    const withoutViteAnonKey = varsWithout('VITE_SUPABASE_ANON_KEY', {
      SUPABASE_ANON_KEY: anonKey,
    });

    expect(() => sessionConfigOf(withoutViteAnonKey)).toThrow(Error);
  });

  it('VITE_SUPABASE_ANON_KEY が空文字なら設定を作らない', () => {
    // B-34 設計 規則12 / 7章1行目 / ADR-043 決定3: 未設定と空文字を同じに扱う。
    expect(() => sessionConfigOf(vars({ VITE_SUPABASE_ANON_KEY: '' }))).toThrow(Error);
  });

  it('空白だけの値でも設定を作りその空白をそのまま持つ', () => {
    // B-34 設計 規則12 後半 / 先行 StockItemFormValues 規則4: 値の正規化を画面側に持ち込まない。
    const config = sessionConfigOf(
      vars({ VITE_SUPABASE_URL: '   ', VITE_SUPABASE_ANON_KEY: '   ' }),
    );

    expect(config).toEqual({ url: '   ', anonKey: '   ' });
  });

  it('VITE_SUPABASE_ANON_KEY を欠いて断るとき例外の message に URL の値を載せない', () => {
    // B-34 設計 7章1行目 / ADR-045 結果2: メッセージは名前までにする。**断ったこと自体を先に断定する** —
    // そうしないと、別の理由で投げられた例外の message も値を含まないので、空振りで緑になる。
    const error = caughtError(() => sessionConfigOf(varsWithout('VITE_SUPABASE_ANON_KEY')));

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('https://example.supabase.co');
  });

  it('VITE_SUPABASE_URL を欠いて断るとき例外の message に anon key の値を載せない', () => {
    // B-34 設計 7章1行目 / ADR-045 結果2: 7章は「URL も鍵も書かない」と**両方**を言っている。
    // 欠ける名前ごとに断る経路が別なので、上の1件では鍵の値を載せる実装が通ってしまう。
    const error = caughtError(() => sessionConfigOf(varsWithout('VITE_SUPABASE_URL')));

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('anon-key-example');
  });
});
