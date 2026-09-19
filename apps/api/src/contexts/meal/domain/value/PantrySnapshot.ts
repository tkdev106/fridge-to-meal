import type { DateTime } from './DateTime.js';
import type { StockItem } from './StockItem.js';

/**
 * 在庫スナップショット。ある時点の在庫の複製で、以後不変（用語表 / C-7）。
 *
 * `Suggestion` が抱えるのは生成時点のものだが、**比べる相手（現在の在庫）も同じ型に写す**ため、
 * 保存されない一時のものも生まれる（ADR-037 決定3）。
 *
 * 抱えるのは献立側の在庫品の列だけである。並べ替えも重複の除去もしない — 期限の近い順に
 * 並べるのは、外へ送る射影の仕事である（B-26 規則7）。**期限切れを落とす規則はこの値が持ち**、
 * 射影と、生成を呼ぶ下限との両方が `unexpiredStockItemsOf` を呼ぶ（ADR-040 決定1）。
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
 * 期限切れの在庫品を落とした在庫品の列を返す（B-31a / ADR-040）。
 *
 * 落とすのは**期限が基準日時の暦日より前**のものだけで、当日は落とさない。期限が未設定の
 * 在庫品も落とさない（FR-13）。返すのは在庫品の列であって在庫スナップショットではない —
 * 濾した結果を在庫スナップショットで返すと `pantrySnapshotEquals` に渡せてしまい、C-7 の
 * 比較が期限切れを落とした相手と突き合わされる（B-31a 規則1）。
 *
 * 並べ替えも重複の除去もせず、受け取ったスナップショットにも手を入れない（B-31a 規則4・規則5）。
 * **残した在庫品は受け取ったものをそのまま返す** — ここで作り直すと、名称も分量も期限も
 * `createStockItem` / `amountOf` / `expiryDateOf` を通った値なのに、2つ目の正規化の規則が
 * この関数に生まれる（B-31a 規則5b / ADR-037 理由(3)）。
 *
 * 在庫0件も全件が期限切れも空の列を返し、投げない。そこで生成を呼ばないと決めるのは
 * 呼ぶ側である（B-31a 規則6・規則7）。
 */
export function unexpiredStockItemsOf(
  pantrySnapshot: PantrySnapshot,
  asOf: DateTime,
): readonly StockItem[] {
  // 暦日を取り出すのは**この1か所だけ**。`DateTime` は `dateTimeOf` が UTC の正準形に
  // 正規化しているので、先頭10文字がそのまま `YYYY-MM-DD` になる。**時間帯で日を切り直すかは
  // まだ決めていない** — ADR-040 結果1 はこれを B-31c へ送ったが、**B-31c は「1日」を遡る24時間の
  // 窓と定めて暦日を使わずに済ませたため、期限の側の時間帯は未決のまま残った**（ADR-048 結果1）。
  // 決まったときに動くのはこの行だけである（B-31a 規則8）。
  const today = asOf.slice(0, 10);

  // 濾すだけで、詰め直しも並べ替えも重複の除去もしない。読むのは受け取った列で、
  // 返すのは新しい列である（B-31a 規則4・規則5 / ADR-009）。
  return Object.freeze(
    pantrySnapshot.stockItems.filter((stockItem) => isUnexpiredOn(stockItem, today)),
  );
}

/**
 * 在庫品がその暦日にまだ期限内かを返す（B-31a 規則2・規則3・規則9）。
 *
 * - 期限が**基準の暦日より前**のときだけ期限切れとする。**当日は落とさない** — 残日数0 は
 *   「期限は今日」であって、その日に使い切るべき在庫だからである（D-2 / FR-18）
 * - 期限が未設定の在庫品は落とさない。期限は任意入力である（FR-13）
 * - 比べるのは文字列の大小で足りる。両辺とも `YYYY-MM-DD` で辞書式が暦順であり、
 *   照合順序が実行環境に依る `localeCompare` は使わない（ADR-036 決定1・結果8）
 */
function isUnexpiredOn(stockItem: StockItem, calendarDate: string): boolean {
  return stockItem.expiryDate === null || stockItem.expiryDate >= calendarDate;
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
