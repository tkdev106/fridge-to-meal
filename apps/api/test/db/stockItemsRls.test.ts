import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { アプリの接続文字列 } from '../support/db/ConnectionStrings.js';
import { トランザクションを張る } from '../support/db/WithTransaction.js';

/**
 * ローカル Postgres に対する行レベルセキュリティの回帰（B-07b 設計 規則1〜16 /
 * ADR-029 決定3(a)(b)(c)・理由(1)(4) / ADR-028 / NFR-09 / C-9）。
 * **`pnpm test:db` でだけ走る** — `pnpm test` は `apps/api/test/db/**` を除外する。
 *
 * 繋ぐのは `authenticator` だけ。所有者（`postgres`）の接続を使うと行レベルセキュリティが
 * 素通りし、**RLS が無くても緑になる**（設計 規則1）。
 *
 * **世帯 ID と在庫品 ID はケースごとに固有の固定値を使い、使い回さない**（設計 規則2）。
 * 表は `globalSetup` で1度だけ作られ、ファイルとケースをまたいで共有されるため。
 * **後片付けはしない**（設計 規則3）。
 */
const 世帯 = '55555555-5555-4555-8555-555555555555';
const 在庫品識別子 = '66666666-6666-4666-8666-666666666666';

const 世帯_読み手 = '11111111-1111-4111-8111-111111111111';
const 世帯_持ち主 = '22222222-2222-4222-8222-222222222222';
const 在庫品識別子_不可視 = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';

const 世帯_書き手 = '33333333-3333-4333-8333-333333333333';
const 世帯_書き先 = '44444444-4444-4444-8444-444444444444';
const 在庫品識別子_作れない = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';

const 世帯_他人の書き換え = '77777777-7777-4777-8777-777777777777';
const 世帯_持ち主_書き換え = '88888888-8888-4888-8888-888888888888';
const 在庫品識別子_書き換えない = 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3';

const 世帯_移送元 = '99999999-9999-4999-8999-999999999999';
const 世帯_移送先 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const 在庫品識別子_移せない = 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4';

const 世帯_他人の削除 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const 世帯_持ち主_削除 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const 在庫品識別子_消せない = 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5';

const 世帯_自分の書き換え = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const 在庫品識別子_書き換える = 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6';

const 世帯_自分の削除 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const 在庫品識別子_消せる = 'f7f7f7f7-f7f7-4f7f-8f7f-f7f7f7f7f7f7';

// 述語を読むだけで行を書かない世帯。読むのは `アプリの接続文字列` のまま
// （`authenticated` でも `pg_policies` は読める）。所有者では繋がない（設計 規則1）。
const 世帯_述語の読み手 = '10101010-1010-4010-8010-101010101010';

// 1本の接続で複数のトランザクションを張る。`local` が次のトランザクションへ漏れて
// いないことは、同じ接続を使い回すことでしか見えない（設計 規則12）。
const 接続 = postgres(アプリの接続文字列, { max: 1 });

afterAll(async () => {
  await 接続.end();
});

type ポリシーの行 = { cmd: string; qual: string | null; with_check: string | null };

/**
 * `stock_items` に実際に入っているポリシーを、**操作（`cmd`）で引ける形**にして返す
 * （設計 規則16）。表全体を読む主張ではないので規則4 には当たらない — 対象は
 * `stock_items` のポリシーだけで、他のケースが在庫品を足しても増えない。
 *
 * **`policyname` ではなく `cmd` で引く。** 名前で引くと、振る舞いを変えない改名で
 * `undefined` どうしの比較になり、**理由の読めない赤**になる。`apps/api/test/migrations/`
 * の守りも `cmd` で解析しており、そちらと揃う。
 */
async function 在庫品のポリシー(): Promise<Map<string, ポリシーの行>> {
  const 読めた行 = await トランザクションを張る(接続, 世帯_述語の読み手, (問い合わせ) => {
    return 問い合わせ<ポリシーの行[]>`
      select cmd, qual, with_check
      from pg_policies
      where tablename = 'stock_items'
    `;
  });

  return new Map(読めた行.map((行) => [行.cmd, 行]));
}

describe('在庫品の行レベルセキュリティ', () => {
  it('クレームを張らなければ同じ接続でも表が0行になり、張り直せば同じ在庫品がもう一度見える', async () => {
    const 見えた行 = await トランザクションを張る(接続, 世帯, async (問い合わせ) => {
      await 問い合わせ`
        insert into stock_items (id, household_id, name)
        values (${在庫品識別子}, ${世帯}, 'にんじん')
      `;
      return 問い合わせ<
        { name: string }[]
      >`select name from stock_items where id = ${在庫品識別子}`;
    });

    // 表全体を読む主張はこの1件だけに限る（設計 規則4）。他のケースが行を足しても
    // 「クレーム無しなら何も見えない」は壊れない。
    const クレーム無しで見えた行 = await トランザクションを張る(接続, null, (問い合わせ) => {
      return 問い合わせ<{ name: string }[]>`select name from stock_items`;
    });

    const 張り直して見えた行 = await トランザクションを張る(接続, 世帯, (問い合わせ) => {
      return 問い合わせ<
        { name: string }[]
      >`select name from stock_items where id = ${在庫品識別子}`;
    });

    // 戻りは件数などを持つ配列なので、素の配列に写してから比べる。
    expect([...見えた行]).toEqual([{ name: 'にんじん' }]);
    // C-9 / NFR-09: クレームが無ければ auth.uid() は null。**例外ではなく0行**になること
    // （設計 規則5 — `current_setting(…, true)` の `true` を落とすと例外に倒れる）。
    expect([...クレーム無しで見えた行]).toEqual([]);
    // 設計 規則13: 1つ目のトランザクションが commit されずに消えていても2つ目は同じ0行を
    // 返す。**3つ目が、0行の理由を「見えない」に絞り込む唯一の手である。**
    expect([...張り直して見えた行]).toEqual([{ name: 'にんじん' }]);
  });

  it('他世帯の在庫品は在庫品 ID で絞って読んでも0行になる', async () => {
    // 設計 規則14: 他世帯の行は**その世帯のクレーム**で置く。自世帯のクレームでは
    // `stock_items_insert` の with check に外れて作れない。
    await トランザクションを張る(接続, 世帯_持ち主, async (問い合わせ) => {
      await 問い合わせ`
        insert into stock_items (id, household_id, name)
        values (${在庫品識別子_不可視}, ${世帯_持ち主}, 'にんじん')
      `;
    });

    const 読み手に見えた行 = await トランザクションを張る(接続, 世帯_読み手, (問い合わせ) => {
      return 問い合わせ<
        { name: string }[]
      >`select name from stock_items where id = ${在庫品識別子_不可視}`;
    });

    const 持ち主に見えた行 = await トランザクションを張る(接続, 世帯_持ち主, (問い合わせ) => {
      return 問い合わせ<
        { name: string }[]
      >`select name from stock_items where id = ${在庫品識別子_不可視}`;
    });

    // C-9 / 設計 規則5: 「見えない」は**例外ではなく0行**で表す。
    expect([...読み手に見えた行]).toEqual([]);
    // 設計 規則10 の同型: 行は実在する。0行が「行が無いから」ではないことの裏取り。
    expect([...持ち主に見えた行]).toEqual([{ name: 'にんじん' }]);
  });

  it('他世帯の世帯 ID を持つ在庫品は作れない', async () => {
    // 設計 規則7: 「作れない」だけが例外になる。insert に using は無く、
    // `stock_items_insert` の with check に外れた書き込みが拒まれる。
    await expect(
      トランザクションを張る(接続, 世帯_書き手, (問い合わせ) => {
        return 問い合わせ`
          insert into stock_items (id, household_id, name)
          values (${在庫品識別子_作れない}, ${世帯_書き先}, 'にんじん')
        `;
      }),
      // 設計 規則9: 文言は Postgres の版とロケールで変わる。SQLSTATE で照合する。
    ).rejects.toMatchObject({ code: '42501' });

    const 書き先に見えた行 = await トランザクションを張る(接続, 世帯_書き先, (問い合わせ) => {
      return 問い合わせ<
        { name: string }[]
      >`select name from stock_items where id = ${在庫品識別子_作れない}`;
    });

    // 設計 規則11: 例外だけでは「書けたうえで見えないだけ」と見分けがつかない。
    // 行の持ち主になるはずだった世帯のクレームで読み、書かれていないことまで見る。
    expect([...書き先に見えた行]).toEqual([]);
  });

  it('他世帯の在庫品は update しても影響行数0になり、値も変わらない', async () => {
    // 設計 規則14: 他世帯の行は**その世帯のクレーム**で置く。
    await トランザクションを張る(接続, 世帯_持ち主_書き換え, async (問い合わせ) => {
      await 問い合わせ`
        insert into stock_items (id, household_id, name)
        values (${在庫品識別子_書き換えない}, ${世帯_持ち主_書き換え}, 'にんじん')
      `;
    });

    // 設計 規則8: 影響行数は `returning id` の戻り行数で数える。
    // ドライバの `count` の意味に寄りかからない。
    const 書き換わった行 = await トランザクションを張る(接続, 世帯_他人の書き換え, (問い合わせ) => {
      return 問い合わせ<{ id: string }[]>`
          update stock_items set name = 'たまねぎ'
          where id = ${在庫品識別子_書き換えない}
          returning id
        `;
    });

    const 持ち主に見えた行 = await トランザクションを張る(
      接続,
      世帯_持ち主_書き換え,
      (問い合わせ) => {
        return 問い合わせ<
          { name: string }[]
        >`select name from stock_items where id = ${在庫品識別子_書き換えない}`;
      },
    );

    // 設計 規則6: `stock_items_update` の using に外れた行は update の対象そのものに
    // ならない。**例外ではなく影響行数0**になる。
    expect([...書き換わった行]).toEqual([]);
    // 設計 規則10: 対象が存在しなければ0件は当たり前に起きる。行が在り、値が元のまま
    // であることまで見る。
    expect([...持ち主に見えた行]).toEqual([{ name: 'にんじん' }]);
  });

  it('自世帯の在庫品の世帯 ID を他世帯へ書き換えられない', async () => {
    await トランザクションを張る(接続, 世帯_移送元, async (問い合わせ) => {
      await 問い合わせ`
        insert into stock_items (id, household_id, name)
        values (${在庫品識別子_移せない}, ${世帯_移送元}, 'にんじん')
      `;
    });

    // 設計 規則7: using には当たる（自世帯の行）が、書き込んだあとの行が世帯の述語に
    // 外れるため**例外**になる。ここが規則5・6 と非対称になる唯一の側である。
    //
    // **この例外が `stock_items_update` の with check から来ていると読まないこと。**
    // with check を `true` に緩めても、新しい行が `stock_items_select` の述語に外れる
    // ために同じ 42501 が返り、このケースは緑のまま通る（設計 規則16 の節）。
    // with check そのものを固定しているのは、末尾の述語の突き合わせのほうである。
    await expect(
      トランザクションを張る(接続, 世帯_移送元, (問い合わせ) => {
        return 問い合わせ`
          update stock_items set household_id = ${世帯_移送先}
          where id = ${在庫品識別子_移せない}
        `;
      }),
    ).rejects.toMatchObject({ code: '42501' });

    const 移送元に見えた行 = await トランザクションを張る(接続, 世帯_移送元, (問い合わせ) => {
      return 問い合わせ<
        { household_id: string }[]
      >`select household_id from stock_items where id = ${在庫品識別子_移せない}`;
    });

    // 設計 規則11: 例外に加えて、行の世帯が移っていないことまで見る。
    expect([...移送元に見えた行]).toEqual([{ household_id: 世帯_移送元 }]);
  });

  it('他世帯の在庫品は delete しても影響行数0になり、行も残る', async () => {
    await トランザクションを張る(接続, 世帯_持ち主_削除, async (問い合わせ) => {
      await 問い合わせ`
        insert into stock_items (id, household_id, name)
        values (${在庫品識別子_消せない}, ${世帯_持ち主_削除}, 'にんじん')
      `;
    });

    const 消えた行 = await トランザクションを張る(接続, 世帯_他人の削除, (問い合わせ) => {
      return 問い合わせ<{ id: string }[]>`
        delete from stock_items
        where id = ${在庫品識別子_消せない}
        returning id
      `;
    });

    const 持ち主に見えた行 = await トランザクションを張る(接続, 世帯_持ち主_削除, (問い合わせ) => {
      return 問い合わせ<
        { name: string }[]
      >`select name from stock_items where id = ${在庫品識別子_消せない}`;
    });

    // 設計 規則6: `stock_items_delete` の using に外れた行は消せない。
    // **例外ではなく影響行数0**になる。
    expect([...消えた行]).toEqual([]);
    // 設計 規則10: 行が在るのに0件であることの裏取り。
    expect([...持ち主に見えた行]).toEqual([{ name: 'にんじん' }]);
  });

  it('自世帯の在庫品は update でき、影響行数1が返る', async () => {
    await トランザクションを張る(接続, 世帯_自分の書き換え, async (問い合わせ) => {
      await 問い合わせ`
        insert into stock_items (id, household_id, name)
        values (${在庫品識別子_書き換える}, ${世帯_自分の書き換え}, 'にんじん')
      `;
    });

    const 書き換わった行 = await トランザクションを張る(接続, 世帯_自分の書き換え, (問い合わせ) => {
      return 問い合わせ<{ id: string }[]>`
          update stock_items set name = 'たまねぎ'
          where id = ${在庫品識別子_書き換える}
          returning id
        `;
    });

    const 見えた行 = await トランザクションを張る(接続, 世帯_自分の書き換え, (問い合わせ) => {
      return 問い合わせ<
        { name: string }[]
      >`select name from stock_items where id = ${在庫品識別子_書き換える}`;
    });

    // 設計 規則15: 「影響行数0」の対。同じ数え方で0でない値が返ることを1度見ないと、
    // `returning id` が常に0を返す形でも using が壊れていても、規則6 のケースは緑のまま通る。
    expect([...書き換わった行]).toEqual([{ id: 在庫品識別子_書き換える }]);
    expect([...見えた行]).toEqual([{ name: 'たまねぎ' }]);
  });

  it('自世帯の在庫品は delete でき、影響行数1が返る', async () => {
    await トランザクションを張る(接続, 世帯_自分の削除, async (問い合わせ) => {
      await 問い合わせ`
        insert into stock_items (id, household_id, name)
        values (${在庫品識別子_消せる}, ${世帯_自分の削除}, 'にんじん')
      `;
    });

    const 消えた行 = await トランザクションを張る(接続, 世帯_自分の削除, (問い合わせ) => {
      return 問い合わせ<{ id: string }[]>`
        delete from stock_items
        where id = ${在庫品識別子_消せる}
        returning id
      `;
    });

    const 見えた行 = await トランザクションを張る(接続, 世帯_自分の削除, (問い合わせ) => {
      return 問い合わせ<
        { name: string }[]
      >`select name from stock_items where id = ${在庫品識別子_消せる}`;
    });

    // 設計 規則15: 「影響行数0」の対。
    expect([...消えた行]).toEqual([{ id: 在庫品識別子_消せる }]);
    expect([...見えた行]).toEqual([]);
  });

  // 設計 規則16: ここから3件は述語そのものを突き合わせる。**振る舞いでは固定できない**
  // ため — update / delete が where で行を指す以上、その行はまず select のポリシーを
  // 通らないと走査に載らず、「select は通るが update の using で弾かれる」入力が
  // 存在しない。実際、この3本を `true` に緩めても上の8件はすべて緑のままだった。
  // **述語の文字列を期待値に書かない**（正規化の形は Postgres の版で変わりうる）。
  // 同じ正規化を通った者どうしを比べる。

  it('4つの操作それぞれにポリシーが入っている', async () => {
    const ポリシー = await 在庫品のポリシー();

    // 1本に畳まれた（`for all`）・1本消えた場合に、下の3件が `undefined` どうしの
    // 比較になる前に、**読める形**でここが落ちる。ADR-029 決定2 は4本を成果物として
    // 固定している。
    expect([...ポリシー.keys()].sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
  });

  it('update ポリシーの using は select ポリシーと同じ述語である', async () => {
    const ポリシー = await 在庫品のポリシー();

    const selectの述語 = ポリシー.get('SELECT')?.qual;
    const updateの述語 = ポリシー.get('UPDATE')?.qual;

    // 比べる前に片方が取れていることを見る。取れていないとポリシーが1本も無くても
    // undefined どうしが等しくなり、緑のまま通る。
    expect(selectの述語).toBeTruthy();
    // C-9: 他世帯の行を掴めないこと。using を緩めると select の側だけが守りになる。
    expect(updateの述語).toBe(selectの述語);
  });

  it('update ポリシーの with check は insert ポリシーと同じ述語である', async () => {
    const ポリシー = await 在庫品のポリシー();

    const insertの述語 = ポリシー.get('INSERT')?.with_check;
    const updateの述語 = ポリシー.get('UPDATE')?.with_check;

    expect(insertの述語).toBeTruthy();
    // C-9: 自世帯の行を他世帯へ移せないこと。
    expect(updateの述語).toBe(insertの述語);
  });

  it('delete ポリシーの using は select ポリシーと同じ述語である', async () => {
    const ポリシー = await 在庫品のポリシー();

    const selectの述語 = ポリシー.get('SELECT')?.qual;
    const deleteの述語 = ポリシー.get('DELETE')?.qual;

    expect(selectの述語).toBeTruthy();
    // C-9: 他世帯の行を消せないこと。
    expect(deleteの述語).toBe(selectの述語);
  });
});
