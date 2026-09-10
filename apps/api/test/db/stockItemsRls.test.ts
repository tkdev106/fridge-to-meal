import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { アプリの接続文字列 } from '../support/db/ConnectionStrings.js';
import { トランザクションを張る } from '../support/db/WithTransaction.js';

/**
 * ローカル Postgres に対する煙テスト（B-07d 設計 規則5・6・7 / ADR-029 決定3(a)(b)(c)・
 * 理由(1)(4) / NFR-09 / C-9）。**`pnpm test:db` でだけ走る** — `pnpm test` は
 * `apps/api/test/db/**` を除外する（設計 規則8）。
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと行レベルセキュリティが
 * 素通りし、**RLS が無くても緑になる**（設計 規則3）。
 */
const 世帯 = '55555555-5555-4555-8555-555555555555';
const 在庫品識別子 = '66666666-6666-4666-8666-666666666666';

// 1本の接続で2つのトランザクションを張る。`local` が次のトランザクションへ漏れて
// いないことまで、同じ接続を使い回すことで見える（設計 規則7）。
const 接続 = postgres(アプリの接続文字列, { max: 1 });

afterAll(async () => {
  await 接続.end();
});

describe('在庫品の行レベルセキュリティ', () => {
  it('クレームを張れば自世帯の在庫品が見え、同じ接続でクレームを張らなければ同じ表が0行になる', async () => {
    const 見えた行 = await トランザクションを張る(接続, 世帯, async (問い合わせ) => {
      await 問い合わせ`
        insert into stock_items (id, household_id, name)
        values (${在庫品識別子}, ${世帯}, 'にんじん')
      `;
      return 問い合わせ<{ name: string }[]>`select name from stock_items`;
    });

    const クレーム無しで見えた行 = await トランザクションを張る(接続, null, (問い合わせ) => {
      return 問い合わせ<{ name: string }[]>`select name from stock_items`;
    });

    // 戻りは件数などを持つ配列なので、素の配列に写してから比べる。
    expect([...見えた行]).toEqual([{ name: 'にんじん' }]);
    // C-9 / NFR-09: クレームが無ければ auth.uid() は null。**例外ではなく0行**になること
    // （設計 規則5 — `current_setting(…, true)` の `true` を落とすと例外に倒れる）。
    expect([...クレーム無しで見えた行]).toEqual([]);
  });
});
