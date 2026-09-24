import type { ShowLatestSuggestionOutput } from '@fridge-to-meal/contract';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { ListStockItems } from '../../pantry/usecase/ListStockItems.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';
import type { SuggestionRepository } from '../domain/repository/SuggestionRepository.js';
import { createPantrySnapshot, pantrySnapshotEquals } from '../domain/value/PantrySnapshot.js';
import { mealByIdOf, suggestionOutputOf, toMealStockItem } from './SuggestMeals.js';

/**
 * 保存済みの提案をそのまま返す（B-58 / FR-21 / NFR-03）。世帯は第1引数で受け取る（C-9）。
 *
 * **生成を一度も呼ばない。** `SuggestMeals` は在庫が前回の提案から変わっていれば作り直し、
 * 作れる既存の献立が0件なら `MealGenerator` を呼ぶ（C-15 / ADR-022。C-7 で短絡しなかった回である）。**画面を開いただけで
 * それが起きると、利用者の求めなしに1日10回の枠（NFR-C2）と費用を使う** — 2026-09-24 に
 * ユーザーが「生成済みの献立は表示しておきたい」と決め、ADR-065 決定1 がそれを経路として置いた。
 * 生成は明示操作（FR-36 / `SuggestNewMeals`）だけで起こる。
 *
 * **基準日時を受け取らない。** 1日の上限（ADR-049）も期限切れの除外（ADR-040）もこの経路には
 * 無く、時刻に依存する判断が1つも無い。
 *
 * **充足は現在の在庫で都度算出する**（FR-32 / ADR-009）— 保存されているのは提案と献立であり、
 * 充足ではない。1週間前の提案でも、今日の在庫で賄えるかが出る。
 */
export type ShowLatestSuggestion = (
  householdId: HouseholdId,
) => Promise<ShowLatestSuggestionOutput>;

export function showLatestSuggestion(deps: {
  listStockItems: ListStockItems;
  mealRepository: MealRepository;
  suggestionRepository: SuggestionRepository;
}): ShowLatestSuggestion {
  return async (householdId) => {
    // **最初に引くのが提案である。** 1件も無ければ在庫も献立も引かずに終える —
    // まだ何も生成していない世帯で、使わない読みを2つ出さない。
    const latestSuggestion = await deps.suggestionRepository.findLatestByHousehold(householdId);
    if (latestSuggestion === null) {
      return { outcome: 'none' };
    }

    // 埋め合わせない（先行 `SuggestMeals`）— 在庫が引けなければそのまま投げる。
    const { stockItems } = await deps.listStockItems(householdId);
    const mealStockItems = stockItems.map(toMealStockItem);

    // 献立は世帯で引く（B-48a 規則4）。提案の1件が指す献立が引けなければ
    // `suggestionOutputOf` が素の `Error` で断る（ADR-045 / ADR-061）。
    const meals = await deps.mealRepository.findByHousehold(householdId);

    return {
      outcome: 'suggested',
      suggestion: suggestionOutputOf(latestSuggestion, mealByIdOf(meals), mealStockItems),
      // **C-7 と同じ比較である**（`SuggestMeals` の短絡）。真なら、押せば違う献立が出る
      // 見込みがあるということであり、**ここでは何も起こさない** — 見せ方は画面が決める。
      pantryChanged: !pantrySnapshotEquals(
        latestSuggestion.pantrySnapshot,
        createPantrySnapshot({ stockItems: mealStockItems }),
      ),
    };
  };
}
