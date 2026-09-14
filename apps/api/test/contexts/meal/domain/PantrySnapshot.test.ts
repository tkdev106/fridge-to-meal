import { describe, expect, it } from 'vitest';
import {
  createPantrySnapshot,
  pantrySnapshotEquals,
} from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
import {
  createStockItem,
  type StockItem,
} from '../../../../src/contexts/meal/domain/value/StockItem.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { expiryDateOf } from '../../../../src/contexts/meal/domain/value/ExpiryDate.js';

/**
 * 献立側の在庫品。引数は **(名称, 分量, 期限)** の順で、分量と期限は本題のときだけ渡す。
 *
 * **`CookableMealFinder.test.ts` の同名のヘルパーは (名称, 期限, 分量) の順である。**
 * 向こうは期限が本題（C-12 の並び）で、こちらは分量が本題（C-7 の一致）だからである。
 */
function stockItem(name: string, amount: string | null = null, expiryDate: string | null = null) {
  return createStockItem({ name, amount: amountOf(amount), expiryDate: expiryDateOf(expiryDate) });
}

/** 在庫スナップショット。抱える在庫品の並びだけが本題になる。 */
function pantrySnapshot(...stockItems: StockItem[]) {
  return createPantrySnapshot({ stockItems });
}

/** 抱えている在庫品の名称を並びのまま取り出す。 */
function namesOf(snapshot: ReturnType<typeof createPantrySnapshot>) {
  return snapshot.stockItems.map((stockItem) => stockItem.name);
}

describe('在庫スナップショット PantrySnapshot', () => {
  it('渡した在庫品を受け取った並びのまま抱える', () => {
    // B-26 規則7: 並べ替えない。期限の近い順に並べるのは外へ送る射影の仕事である。
    const snapshot = pantrySnapshot(
      stockItem('たまねぎ', null, '2026-09-30'),
      stockItem('にんじん', null, '2026-09-20'),
    );

    expect(namesOf(snapshot)).toEqual(['たまねぎ', 'にんじん']);
  });

  it('在庫品の列だけを抱える', () => {
    // 設計書6章: 抱えるのは在庫品の列だけ。世帯も日時も持たず、それらは Suggestion の側にある。
    const created = stockItem('にんじん');

    expect(pantrySnapshot(created)).toEqual({
      __brand: 'PantrySnapshot',
      stockItems: [created],
    });
  });

  it('在庫が0件のスナップショットを作れる', () => {
    // B-26 規則8: 在庫が空なのは正常な状態である。そのとき生成を呼ばない判断は呼ぶ側にある。
    expect(pantrySnapshot().stockItems.length).toBe(0);
  });

  it('同じ名称・分量・期限の在庫品が2件あっても畳まない', () => {
    // B-26 規則7 / ADR-007: 在庫品は同じ食材でも統合しない。畳むと、同じ卵をもう1パック
    // 足した日に「在庫は変わっていない」と判定してしまう。
    const snapshot = pantrySnapshot(
      stockItem('卵', '6個', '2026-09-20'),
      stockItem('卵', '6個', '2026-09-20'),
    );

    expect(snapshot.stockItems.length).toBe(2);
  });

  it('期限を過ぎた日付の在庫品も落とさない', () => {
    // B-26 規則9 / prompt-design D-5: 落とすのは外へ送る射影だけ。一致比較には含める。
    const snapshot = pantrySnapshot(stockItem('にんじん', null, '2020-01-01'));

    expect(snapshot.stockItems.length).toBe(1);
    expect(snapshot.stockItems[0]?.expiryDate).toBe('2020-01-01');
  });

  it('受け取った配列を複製して抱える', () => {
    // B-26 規則7: 複製しないと、呼ぶ側が持ち続けている参照から中身が変わる。
    // スナップショットは生成時点の在庫であり、以後動いてはいけない（先行 createMeal）。
    const passedStockItems = [stockItem('にんじん')];
    const snapshot = createPantrySnapshot({ stockItems: passedStockItems });

    passedStockItems.push(stockItem('たまねぎ'));

    expect(snapshot.stockItems.length).toBe(1);
  });

  it('抱えている列に在庫品を後から足せない', () => {
    // B-26 規則7: 列そのものも凍結する。凍結しないと、複製した意味が無くなる。
    const snapshot = pantrySnapshot(stockItem('にんじん'));

    expect(() => (snapshot.stockItems as StockItem[]).push(stockItem('たまねぎ'))).toThrow(
      TypeError,
    );
  });

  it('作ったあとに抱えている列を差し替えられない', () => {
    // B-26 規則7 / C-7: 差し替えられると、一致比較が見ている中身が後から動く。
    const snapshot = pantrySnapshot(stockItem('にんじん'));

    expect(() => {
      (snapshot as { stockItems: readonly StockItem[] }).stockItems = [];
    }).toThrow(TypeError);
  });
});

describe('在庫スナップショットの一致 pantrySnapshotEquals', () => {
  it('同じ名称・分量・期限の在庫品からなる2つは一致する', () => {
    // C-7 / B-26 規則10: 一致するのは3項目の多重集合であり、別インスタンスかどうかは見ない。
    const left = pantrySnapshot(stockItem('にんじん', '1本', '2026-09-20'));
    const right = pantrySnapshot(stockItem('にんじん', '1本', '2026-09-20'));

    expect(pantrySnapshotEquals(left, right)).toBe(true);
  });

  it('並びが違っても、同じ在庫品の組なら一致する', () => {
    // B-26 規則10: 多重集合なので並びに依存しない。在庫の並びが変わっただけで
    // 生成を呼び直すと、C-7 が費用を抑える意味が無くなる。
    const left = pantrySnapshot(stockItem('にんじん'), stockItem('たまねぎ'));
    const right = pantrySnapshot(stockItem('たまねぎ'), stockItem('にんじん'));

    expect(pantrySnapshotEquals(left, right)).toBe(true);
  });

  it('同じ在庫品が2件ある側と1件だけの側は一致しない', () => {
    // ADR-037 決定2: 件数を数える。重複を畳む集合にすると、同じ卵をもう1パック
    // 足した日に「在庫は変わっていない」と判定する。
    const left = pantrySnapshot(stockItem('卵'), stockItem('卵'));
    const right = pantrySnapshot(stockItem('卵'));

    expect(pantrySnapshotEquals(left, right)).toBe(false);
  });

  it('件数の内訳だけが違う2つは一致しない', () => {
    // ADR-037 決定2: 総数が同じでも内訳が違えば別の在庫である。種類の集合でも
    // 総数でもなく、3項目ごとの件数で見る。
    const left = pantrySnapshot(stockItem('卵'), stockItem('卵'), stockItem('牛乳'));
    const right = pantrySnapshot(stockItem('卵'), stockItem('牛乳'), stockItem('牛乳'));

    expect(pantrySnapshotEquals(left, right)).toBe(false);
  });

  it('在庫が0件どうしは一致する', () => {
    // B-26 規則8 / C-7: 在庫が空のまま変わっていないことも「一致」である。
    expect(pantrySnapshotEquals(pantrySnapshot(), pantrySnapshot())).toBe(true);
  });

  it('名称だけが違う2つは一致しない', () => {
    // C-7 / C-6: 名称は完全一致で比べる。
    const left = pantrySnapshot(stockItem('にんじん'));
    const right = pantrySnapshot(stockItem('たまねぎ'));

    expect(pantrySnapshotEquals(left, right)).toBe(false);
  });

  it('分量だけが違う2つは一致しない', () => {
    // ADR-037 決定1: 分量を比較に入れるために献立側の在庫品へ足した。見ないなら足す意味が無い。
    const left = pantrySnapshot(stockItem('卵', '6個'));
    const right = pantrySnapshot(stockItem('卵', '10個'));

    expect(pantrySnapshotEquals(left, right)).toBe(false);
  });

  it('期限だけが違う2つは一致しない', () => {
    // C-7: 期限も一致比較の3項目の1つである。
    const left = pantrySnapshot(stockItem('卵', null, '2026-09-20'));
    const right = pantrySnapshot(stockItem('卵', null, '2026-09-21'));

    expect(pantrySnapshotEquals(left, right)).toBe(false);
  });

  it('分量も期限も持たない在庫品どうしは一致する', () => {
    // B-26 規則11: null どうしは一致する。
    const left = pantrySnapshot(stockItem('にんじん', null, null));
    const right = pantrySnapshot(stockItem('にんじん', null, null));

    expect(pantrySnapshotEquals(left, right)).toBe(true);
  });

  it('分量を持たない側と分量を持つ側は一致しない', () => {
    // B-26 規則11: null と値は不一致。分量を書き足した在庫は、変わった在庫である。
    const left = pantrySnapshot(stockItem('卵', null));
    const right = pantrySnapshot(stockItem('卵', '6個'));

    expect(pantrySnapshotEquals(left, right)).toBe(false);
  });

  it('期限を持たない側と期限を持つ側は一致しない', () => {
    // B-26 規則11: null と値は不一致。期限を書き足した在庫は、変わった在庫である。
    const left = pantrySnapshot(stockItem('卵', null, null));
    const right = pantrySnapshot(stockItem('卵', null, '2026-09-20'));

    expect(pantrySnapshotEquals(left, right)).toBe(false);
  });

  it('分量なしを表しそうな字面を分量に持つ在庫品は、分量を持たない在庫品と一致しない', () => {
    // B-26 規則11 / C-7 / ADR-010: 比べるのは 3 項目の組で、`null` と値は決して一致しない。
    // 分量は自由文字列なので、「分量なし」を表すのに使いたくなる字面もそのまま分量になりうる。
    // この入力でなければ効かない: 分量が「6個」なら、`null` を同じ印に畳む実装でも組が分かれて
    // 一致しないと出る。分量そのものがその印と同じ字面のときだけ「分量なし」と衝突する。
    const left = pantrySnapshot(stockItem('にんじん', '-'));
    const right = pantrySnapshot(stockItem('にんじん'));

    expect(pantrySnapshotEquals(left, right)).toBe(false);
  });

  it('分量は文字どおり比べ、途中の空白を詰めない', () => {
    // B-26 規則11 / ADR-010: 正規化済みの値どうしの文字どおりの一致。分量は自由文字列であり、
    // 「200g」と「200 g」は別の分量である（C-6 と同じ割り切り）。
    const left = pantrySnapshot(stockItem('にんじん', '200g'));
    const right = pantrySnapshot(stockItem('にんじん', '200 g'));

    expect(pantrySnapshotEquals(left, right)).toBe(false);
  });

  it('項目の境をまたいで同じ字面になる2つは一致しない', () => {
    // C-7 / B-26 規則10・11 / ADR-010: 比べるのは3項目の「組」である。名称も分量も自由文字列で、
    // 項目の区切りに使える文字を含みうる。名称に「卵 6個」と書いた在庫品と、名称「卵」に
    // 分量「6個」を分けて持つ在庫品は、字面を繋げば同じでも別の組であり、別の在庫である。
    const left = pantrySnapshot(stockItem('卵 6個'));
    const right = pantrySnapshot(stockItem('卵', '6個'));

    expect(pantrySnapshotEquals(left, right)).toBe(false);
  });

  it('期限を過ぎた在庫品の有無も一致の判定に効く', () => {
    // B-26 規則9 / prompt-design D-5: 期限切れを落とすのは外へ送る射影だけ。
    // 一致比較で落とすと、期限切れを捨てた日に「在庫は変わっていない」と判定する。
    const left = pantrySnapshot(
      stockItem('にんじん', null, '2020-01-01'),
      stockItem('たまねぎ', null, '2026-09-30'),
    );
    const right = pantrySnapshot(stockItem('たまねぎ', null, '2026-09-30'));

    expect(pantrySnapshotEquals(left, right)).toBe(false);
  });

  it('比べても、渡したスナップショットの中身は変わらない', () => {
    // B-26 規則7: 多重集合で比べるために畳んでも並べ替えても、渡された値には手を入れない。
    const left = pantrySnapshot(stockItem('にんじん'), stockItem('たまねぎ'));
    const right = pantrySnapshot(stockItem('たまねぎ'), stockItem('にんじん'));

    pantrySnapshotEquals(left, right);

    expect(namesOf(left)).toEqual(['にんじん', 'たまねぎ']);
  });
});
