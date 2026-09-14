import type { Meal } from '../entity/Meal.js';
import { createCookableMeal } from '../value/CookableMeal.js';
import type { CookableMeal } from '../value/CookableMeal.js';
import type { ExpiryDate } from '../value/ExpiryDate.js';
import type { StockItem } from '../value/StockItem.js';
import { mealCoverageOf } from './MealCoverageService.js';

/**
 * 作れる献立と、その並びの第1段に使う「期限の列」（ADR-036 決定1）。
 *
 * 列を献立ごとに1度だけ作って持ち回るための組。比較関数は並べ替えのあいだ何度も
 * 呼ばれるため、そのつど列を組み直すと同じ畳み込みを繰り返すことになる。
 */
type RankedCookableMeal = {
  readonly cookableMeal: CookableMeal;
  /** 昇順に並べた期限の列。期限つきの在庫を1件も使わない献立では空になる。 */
  readonly expiryDates: readonly ExpiryDate[];
};

/**
 * 手持ちの在庫で**不足0件**の献立だけを選び出し、**C-12 の順に並べて全件返す**
 * （C-10 / C-12 / FR-34 / ADR-036 決定1・2・4）。
 *
 * 絞り込み:
 *
 * - 不足かどうかの判定は `mealCoverageOf` に委ねる。突き合わせの対象が主材料だけで
 *   あること（C-16 / ADR-023）も、名称の完全一致で両側の前後空白だけを落とすこと
 *   （C-6）も、委ねた先が既に持っている規則である
 * - 「ほぼ作れる」は返さない。再利用の対象は不足0件のものだけ（C-10）
 * - 期限は**賄えるかどうかに関わらない**。突き合わせは名称だけで行い、期限は
 *   並び順にだけ効く（ADR-036 結果3）。基準日を引数に取らないため、期限切れを
 *   見分ける手立ては持たない（ADR-036 決定1）
 * - **在庫品の分量は受け取るが読まない。** 充足にも並び順にも効かず、同じ在庫で分量だけが
 *   違っても結果は変わらない（C-6 / ADR-010 / ADR-036 決定1）。在庫品が分量を持つのは
 *   C-7 の一致比較のためであり（ADR-037 決定1）、**この後退を型ではなくここで言うことに
 *   なったのは ADR-037 結果1 が引き受けた代償である**
 * - 0件は例外にせず空の列を返す。作れるものが無いのは生成へ回る正常な経路である（C-15）
 * - 上位3件に切らない。C-11 の除外も切り取りも呼ぶ側の仕事である（ADR-036 決定4 / 結果7）
 * - 世帯が同じであることは確かめない。同じ世帯の献立と在庫を渡すのは呼ぶ側の責務
 *   （ADR-033 結果2）
 *
 * 並び（C-12 の4段の鍵。差がついた段で決まる）:
 *
 * 1. **期限の列の辞書式比較**（`compareExpiryDates`）。「期限の近い在庫をより多く使う」を、
 *    近さの線を1つも選ばずに量る形である（ADR-036 決定1 / 理由1）
 * 2. **調理記録の有無。** 件数の多寡は順位を動かさない（ADR-036 / C-12）
 * 3. **生成日時の新しい順**（降順）
 * 4. **`MealId` の昇順。** ここで全順序が閉じる。1回の生成で作られた献立は生成日時が
 *    同じになりうるため、この段が無いと同点が残り、並びが決定的でなくなる
 *    （ADR-036 決定2 / 結果8）
 *
 * 受け取った2つの配列はどちらも読むだけで、並べ替えるのはここで組んだ配列である。
 * 返す列は凍結する（ADR-009 / 先行 `mealCoverageOf`）。
 */
export function cookableMealsOf(
  meals: readonly Meal[],
  stockItems: readonly StockItem[],
): readonly CookableMeal[] {
  // 充足は在庫を名称の列で受け取る。期限は不足の判定に関わらないので渡さない。
  const stockItemNames = stockItems.map((stockItem) => stockItem.name);
  // 期限の列に使う畳み込みは、献立の件数によらず1度だけ行う。
  const earliestExpiryDates = earliestExpiryDateByName(stockItems);

  const rankedCookableMeals: RankedCookableMeal[] = [];
  // 同じ識別子は同じ献立を指す。判定の前に畳むことで、同じ献立を2度出さない（C-13）。
  const seenMealIds = new Set<Meal['id']>();
  for (const meal of meals) {
    if (seenMealIds.has(meal.id)) continue;
    seenMealIds.add(meal.id);

    if (mealCoverageOf(meal.ingredients, stockItemNames).missing.length > 0) continue;

    rankedCookableMeals.push({
      cookableMeal: createCookableMeal({ meal }),
      expiryDates: expiryDatesUsedBy(meal, earliestExpiryDates),
    });
  }

  // 並べ替えるのはこの関数が組んだ配列であって、受け取った配列ではない。呼ぶ側が
  // 持ち続けている献立の並びも在庫の並びも変わらない。
  rankedCookableMeals.sort(byReuseOrder);

  // 受け取った側が積み増せる器ではない。都度の算出結果である（ADR-009）。
  return Object.freeze(rankedCookableMeals.map((ranked) => ranked.cookableMeal));
}

/**
 * 在庫品を名称で畳み、名称ごとに**最も早い期限**を選ぶ（ADR-036 決定1(ii)(iii) / 結果4）。
 *
 * - 期限を持たない在庫品は入らない。期限未設定の在庫品は並び順に一切効かない（結果3）
 * - そのため、期限を持つ在庫品が1件も無い名称は**まとまり自体が残らない**
 * - 畳むのは、買い置きの多さで順位が動くのを避けるためである。畳まないと「同じ食材を
 *   何個も持っている献立が上に来る」という別の量りになる（結果4）
 * - 名称の前後空白を落とすのは `mealCoverageOf` と同じ扱い。片側だけ別の正規化にすると
 *   賄えると判定した在庫の期限が列に入らない、といったずれ方をする（C-6）
 */
function earliestExpiryDateByName(
  stockItems: readonly StockItem[],
): ReadonlyMap<string, ExpiryDate> {
  const earliestExpiryDates = new Map<string, ExpiryDate>();
  for (const stockItem of stockItems) {
    const name = stockItem.name.trim();
    if (name === '') continue;

    const expiryDate = stockItem.expiryDate;
    if (expiryDate === null) continue;

    const known = earliestExpiryDates.get(name);
    if (known === undefined || compareCodeUnits(expiryDate, known) < 0) {
      earliestExpiryDates.set(name, expiryDate);
    }
  }
  return earliestExpiryDates;
}

/**
 * 献立が使う在庫の期限を昇順に並べた列を作る（ADR-036 決定1(i) / B-14b 規則10-2・10-3）。
 *
 * - 対象は**主材料だけ**。調味料は常備の前提で突き合わせに載らないため、名称の一致する
 *   在庫があってもその期限は列に入らない（C-16 / ADR-023）
 * - 主材料の名称は**重複を除く**。同じ名称を2度書いた献立の列が長くなって順位が動くのは、
 *   分量を按分しないこと（ADR-010）と釣り合わない
 * - 期限を持つ在庫を1件も使わない献立は**空の列**になり、第1段ではつねに最下位に並ぶ（結果3）
 */
function expiryDatesUsedBy(
  meal: Meal,
  earliestExpiryDates: ReadonlyMap<string, ExpiryDate>,
): readonly ExpiryDate[] {
  const seenNames = new Set<string>();
  const expiryDates: ExpiryDate[] = [];
  for (const ingredient of meal.ingredients) {
    if (ingredient.kind !== 'main') continue;

    const name = ingredient.name.trim();
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    const expiryDate = earliestExpiryDates.get(name);
    if (expiryDate !== undefined) expiryDates.push(expiryDate);
  }

  // 期限は `YYYY-MM-DD` なので、日付に変換せず文字列の大小で昇順に並べられる。
  return expiryDates.sort(compareCodeUnits);
}

/** C-12 の4段の鍵。上から順に見て、差がついた段で決まる（ADR-036 決定1・2）。 */
function byReuseOrder(left: RankedCookableMeal, right: RankedCookableMeal): number {
  const expiryDatesDifference = compareExpiryDates(left.expiryDates, right.expiryDates);
  if (expiryDatesDifference !== 0) return expiryDatesDifference;

  const leftMeal = left.cookableMeal.meal;
  const rightMeal = right.cookableMeal.meal;

  // 第2段。見るのは**有無**だけで、件数の多寡は順位を動かさない（C-12）。
  const leftHasCookingRecord = leftMeal.cookingRecords.length > 0;
  const rightHasCookingRecord = rightMeal.cookingRecords.length > 0;
  if (leftHasCookingRecord !== rightHasCookingRecord) return leftHasCookingRecord ? -1 : 1;

  // 第3段。生成日時の新しい順（降順）。`DateTime` は UTC の正準形に正規化済みなので、
  // 文字列の大小がそのまま時刻の順になる。
  const generatedAtDifference = compareCodeUnits(rightMeal.generatedAt, leftMeal.generatedAt);
  if (generatedAtDifference !== 0) return generatedAtDifference;

  // 第4段。`MealId` の昇順で全順序が閉じる（ADR-036 決定2 / 結果8）。
  return compareCodeUnits(leftMeal.id, rightMeal.id);
}

/**
 * 期限の列を辞書式に比べる（ADR-036 決定1 / 理由1）。
 *
 * - **最初に違ったところで、期限の早いほうが上**
 * - 先頭から一致したまま**片方が尽きたら、長いほうが上** — 残っている期限のぶん、
 *   その先の線で件数が多い。空の列が空でない列の下に来るのはこの規則の帰結である
 * - 長さも中身も同じなら同点として、次の鍵へ送る
 *
 * 昇順の列をこう比べることは、「件数が最初に食い違う最も早い期限で、多いほうを上とする」
 * 順序と一致する。**近さの線を固定しないまま C-12 の「より多く」を量れる**のが、この形を
 * 採った理由である。
 */
function compareExpiryDates(left: readonly ExpiryDate[], right: readonly ExpiryDate[]): number {
  for (const [index, leftExpiryDate] of left.entries()) {
    const rightExpiryDate = right[index];
    if (rightExpiryDate === undefined) break;

    const difference = compareCodeUnits(leftExpiryDate, rightExpiryDate);
    if (difference !== 0) return difference;
  }

  return right.length - left.length;
}

/**
 * コード単位の大小で比べる（先行 `ListStockItems`）。
 *
 * 照合順序は実行環境の ICU に依存するため `localeCompare` を使わない。コード単位なら
 * Workers と Node で同じ並びになる（ADR-036 結果8 / C-12 の決定性）。
 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
