import type { ListIngredientNamesOutput } from '@fridge-to-meal/contract';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { ListSavedStockItemNames } from '../../pantry/usecase/ListSavedStockItemNames.js';
import type { ListStockItems } from '../../pantry/usecase/ListStockItems.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';

/**
 * その世帯の在庫品の名称と、これまでに保存したことのある在庫品の名称と、保存済みの献立の
 * 主材料の名称を、重複なく決まった順に集める（FR-02 / ADR-063 / B-50d）。世帯は第1引数で受け取る（C-9）。
 *
 * **在庫と献立の2コンテキストにまたがる口を献立の usecase に置く**（ADR-063 決定1）。
 * 献立の usecase はすでに在庫の `ListStockItems` を引いており、在庫の側に置くと
 * コンテキストが互いに依存する。在庫は名称の列（プリミティブ）としてだけ受け取る（ADR-033）。
 *
 * **消した在庫品の名称も出る**（B-50d）。在庫品は物理削除されるため、入力の履歴は在庫の
 * コンテキストが持ち（`ListSavedStockItemNames`）、ここはそれを名称の列として引く（ADR-063 決定2。
 * 依存の向きは献立 → 在庫の1本のまま）。今ある在庫品の名称も出所に残す — 履歴は B-50d より前に
 * 登録された在庫品の名称を持たないためである。
 *
 * 出力の型は `packages/contract` が持つ（B-50b 設計書4章 / ADR-003）。**ここから再 export
 * しない** — 経路も web も contract を直に見る（先行 `ListStockItems`）。
 */
export type ListIngredientNames = (householdId: HouseholdId) => Promise<ListIngredientNamesOutput>;

/**
 * 食材名を集めるユースケースを組み立てる。依存は引数で受け取り、実装の生成は `main.ts` に
 * 任せる（ADR-002）。受け取った例外は握りつぶさず、そのまま呼び出し側へ伝える
 * （先行 `ListStockItems`）。
 */
export function listIngredientNames(deps: {
  listStockItems: ListStockItems;
  listSavedStockItemNames: ListSavedStockItemNames;
  mealRepository: MealRepository;
}): ListIngredientNames {
  return async (householdId) => {
    const { stockItems } = await deps.listStockItems(householdId);
    const savedStockItemNames = await deps.listSavedStockItemNames(householdId);
    const meals = await deps.mealRepository.findByHousehold(householdId);

    // 重複は名称の完全一致で畳む（ADR-063 決定4 / C-6）。表記ゆれを吸収すると、補完で選んだ
    // 名称が献立の材料名と一致しなくなり、充足の判定が静かにずれる。前後の空白は在庫品も
    // 材料も生成時に落としているので、ここでは何も正規化しない。
    const names = new Set<string>();
    for (const stockItem of stockItems) names.add(stockItem.name);
    for (const name of savedStockItemNames) names.add(name);
    for (const meal of meals) {
      for (const ingredient of meal.ingredients) {
        // 調味料は補完に出さない（prompt-design 論点3 / ADR-063 決定3）。在庫品の名称は種別を
        // 持たないため、利用者が登録した名称は調味料であっても上で入っている。
        if (ingredient.kind === 'main') names.add(ingredient.name);
      }
    }

    return { ingredientNames: [...names].sort(compareCodeUnits) };
  };
}

/**
 * コード単位の大小で比べる（ADR-063 決定4）。照合順序は実行環境の ICU に依存するため
 * `localeCompare` を使わない（先行 `ListStockItems`）。
 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
