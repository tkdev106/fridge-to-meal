/**
 * 献立カード1枚ぶんの組み立て（B-49a / `docs/screen-design.md` 3.3 D-3・D-4）。
 *
 * **判断はここに置き、`.tsx` に置かない**（先行 `PantrySections.ts` / `Tabs.ts`）。
 * 何件と書くか・どの在庫を「使う」に出すか・印を付けるかは置き場所を誤ると黙って変わるうえ、
 * ここなら仮の文言にも jsdom にも依存せずに確かめられる。
 *
 * **日本語（印の文言・件数の言い回し）はここに置かない。** 文言も配色も未確定であり
 * （同書 論点3）、持たせるとテストが仮の文言を固定してしまう（ADR-052 結果2）。
 *
 * **受け取るのは contract の提案の1件である**（`SuggestionEntryOutput`）。web で第2の DTO を
 * 持たず、詰め替えるのは**画面が読む形に畳むところだけ**にする。
 */

import type { CoveredMealIngredientDto, SuggestionEntryOutput } from '@fridge-to-meal/contract';

/**
 * カードの「使う:」に出す在庫1件（D-4）。
 *
 * `expiringToday` は**基準日と同じ期限**であることだけを表す。**色だけに頼らない**ための
 * 手がかりであり（NFR-17）、印そのものの形と文言は `.tsx` が決める。
 *
 * **期限を過ぎたものに別の印を置かない。** `docs/screen-design.md` D-4 が決めているのは
 * 「期限が今日の食材に `(今日)` を添える」ところまでで、超過の見せ方は決まっていない
 * （同書 論点3）。在庫一覧の側（`RemainingDays.ts`）は「N日過ぎ」を出すが、**献立のカードへ
 * 持ち込むのはこの周の決めごとではない。**
 */
export type MealCardStockItem = {
  readonly name: string;
  readonly expiringToday: boolean;
};

/** カード1枚（D-4）。**材料の内訳は持たない** — 内訳は献立詳細（B-53）の持ち分である。 */
export type MealCard = {
  readonly mealId: string;
  readonly title: string;
  /** 再利用の印を置くか（FR-35 / D-3）。**生成には置かない** — 両方に付けると印が消える。 */
  readonly reused: boolean;
  /** 材料の件数。**主材料だけで数える**（C-16 / D-4）。 */
  readonly ingredientCount: number;
  /** 不足する材料の件数。**同じく主材料だけである**（C-16 / ADR-023）。 */
  readonly missingCount: number;
  /** 「使う:」に出す在庫。**期限の早い順に3件まで**（FR-18 / D-4）。 */
  readonly usedStockItems: readonly MealCardStockItem[];
};

/**
 * 「使う:」に出す上限（D-4「期限が近い在庫を優先して2〜3件」）。
 *
 * カードに材料を全部並べると縦に伸び、**3件を見比べられなくなる。**
 */
const MAX_USED_STOCK_ITEMS = 3;

/**
 * 賄える材料を期限の早い順に畳む。
 *
 * - 期限を持たないものは**後ろに回す**。期限未設定の在庫品は期限による優先の対象外である（FR-13）
 * - 比べるのは `YYYY-MM-DD` の**コード単位**である。書式が固定なので辞書式の大小が暦の前後と
 *   一致し、`localeCompare` のように実行環境の ICU へ依存しない（先行 `earliestExpiryDateByName`）
 * - **同じ期限は材料の並びのまま**保つ。並べ替えは決定的でなければならない（C-12）ため、
 *   添え字を第2の鍵に使って安定させる
 */
function byEarliestExpiryDate(
  covered: readonly CoveredMealIngredientDto[],
): readonly CoveredMealIngredientDto[] {
  return covered
    .map((ingredient, position) => ({ ingredient, position }))
    .sort((left, right) => {
      const leftDate = left.ingredient.expiryDate;
      const rightDate = right.ingredient.expiryDate;

      if (leftDate !== rightDate) {
        if (leftDate === null) return 1;
        if (rightDate === null) return -1;

        return leftDate < rightDate ? -1 : 1;
      }

      return left.position - right.position;
    })
    .map(({ ingredient }) => ingredient);
}

/**
 * 提案の1件をカードに畳む（D-3 / D-4）。
 *
 * **材料の件数は `ingredients` の長さではない。** 充足に載るのは主材料だけであり
 * （C-16 / ADR-023 / `mealCoverageOf`）、調味料を含めると「材料9件・不足なし」のように見えて
 * **その献立の規模が伝わらなくなる**（D-4）。賄えるものと不足するものの合計がそのまま
 * 主材料の件数である。
 *
 * **並べ替えるのは「使う:」の中だけ**で、カードどうしの並びは提案のままである（C-12）。
 */
export function mealCardsOf(
  entries: readonly SuggestionEntryOutput[],
  today: string,
): readonly MealCard[] {
  return entries.map((entry) => ({
    mealId: entry.mealId,
    title: entry.title,
    // 生成した献立が既存と同名だったために既存を参照した回も `'generated'` である（C-4c / D-3）。
    reused: entry.origin === 'reused',
    ingredientCount: entry.coverage.covered.length + entry.coverage.missing.length,
    missingCount: entry.coverage.missing.length,
    usedStockItems: byEarliestExpiryDate(entry.coverage.covered)
      .slice(0, MAX_USED_STOCK_ITEMS)
      .map((ingredient) => ({
        name: ingredient.name,
        expiringToday: ingredient.expiryDate === today,
      })),
  }));
}
