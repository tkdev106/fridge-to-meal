import type { StockItem } from './StockItem.js';

/**
 * 在庫スナップショット。ある時点の在庫の複製で、以後不変（用語表 / C-7）。
 *
 * `Suggestion` が抱えるのは生成時点のものだが、**比べる相手（現在の在庫）も同じ型に写す**ため、
 * 保存されない一時のものも生まれる（ADR-037 決定3）。
 *
 * 抱えるのは献立側の在庫品の列だけである。並べ替えも重複の除去もしない — 期限の近い順に
 * 並べるのも期限切れを落とすのも、外へ送る射影の仕事である（B-26 規則7 / 規則9）。
 */
export type PantrySnapshot = {
  /** 生成の経路を1つに絞るための印。素のオブジェクトリテラルを PantrySnapshot として扱えなくする。 */
  readonly __brand: 'PantrySnapshot';
  readonly stockItems: readonly StockItem[];
};

/**
 * 在庫スナップショットを作る。受け取った列を複製して凍結する（B-26 規則7）。
 *
 * 在庫0件も通す。在庫が空なのは正常な状態であり、そのとき生成を呼ばない判断は
 * 呼ぶ側にある（B-26 規則8）。
 */
export function createPantrySnapshot(props: { stockItems: readonly StockItem[] }): PantrySnapshot {
  // 複製してから凍結する。複製しないと、呼ぶ側が持ち続けている参照から中身が動き、
  // 「生成時点の在庫」という言い分が成り立たなくなる（先行 createMeal）。
  return Object.freeze({
    __brand: 'PantrySnapshot' as const,
    stockItems: Object.freeze([...props.stockItems]),
  });
}

/**
 * 2つの在庫スナップショットが一致するかを返す（C-7 / ADR-037 決定2）。
 *
 * 一致は `(name, amount, expiryDate)` の多重集合で見る。並びには依存せず、件数は数える。
 * この述語を使って「生成を呼ばない」と判断するのはユースケース層である（B-26 規則13）。
 */
export function pantrySnapshotEquals(left: PantrySnapshot, right: PantrySnapshot): boolean {
  // 総数が違えば、内訳を数えるまでもなく別の在庫である。
  if (left.stockItems.length !== right.stockItems.length) return false;

  // 数えるのはここで組んだ表であって、渡された列ではない。並べ替えも書き換えもしないので、
  // 呼ぶ側が持っているスナップショットは比べたあとも動かない（B-26 規則7）。
  const remaining = countByStockItem(left.stockItems);
  for (const stockItem of right.stockItems) {
    const key = stockItemKey(stockItem);
    const count = remaining.get(key);
    // 左に無い組が右にあれば、そこで一致しないと決まる。
    if (count === undefined) return false;

    if (count === 1) {
      remaining.delete(key);
    } else {
      remaining.set(key, count - 1);
    }
  }

  // 総数が同じで、右の全件を左から取り除けた以上、左に残る組は無い。
  return true;
}

/**
 * 在庫品を3項目の組ごとに数える（ADR-037 決定2）。
 *
 * 畳まずに数えるのは、同じ食材でも在庫品を統合しないため（ADR-007）。重複を畳む集合に
 * すると、**同じ卵をもう1パック足した日に「在庫は変わっていない」と判定してしまう。**
 */
function countByStockItem(stockItems: readonly StockItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const stockItem of stockItems) {
    const key = stockItemKey(stockItem);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * 3項目を1つの鍵に畳む。**値はそのまま使い、再正規化しない**（B-26 規則11）— 名称は
 * `createStockItem` が、分量は `amountOf` が、期限は `expiryDateOf` が既に正規化しており、
 * ここで二重に掛けると正規化の規則が2か所に散る（ADR-037 理由(3)）。
 *
 * 長さを前置きするのは、名称も分量も自由文字列だからである（ADR-010）。**値の中身が項目の境を
 * 動かせない形にしないと、組の違う2件が同じ鍵に畳まれて一致と判定される。** 実際に畳まれる形が
 * 2つあり、どちらもテストが番人になっている。
 *
 * - **`null` の項目を落として区切り文字で繋ぐ形** — 分量なしの `'卵 6個'` と、分量 `'6個'` の `'卵'` が
 *   衝突する（区切りが空白のとき）
 * - **`null` を `'-'` のような印に畳む形** — 分量がその印と同じ字面（`'-'`）の在庫品と、分量なしの
 *   在庫品が衝突する
 */
function stockItemKey(stockItem: StockItem): string {
  return [stockItem.name, stockItem.amount, stockItem.expiryDate].map(fieldKey).join('');
}

/** 1項目ぶんの鍵。`null` は値と決して同じ鍵にならない形にする（B-26 規則11）。 */
function fieldKey(value: string | null): string {
  // 値の側はつねに数字で始まるので、`-` と取り違えることがない。
  return value === null ? '-' : `${value.length}:${value}`;
}
