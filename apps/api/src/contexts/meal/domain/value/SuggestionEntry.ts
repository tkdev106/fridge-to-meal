import type { MealId } from './MealId.js';

/** 提案の1件の由来（C-4c）。この提案でどの経路から来たかを表す。 */
export type SuggestionEntryOrigin = 'generated' | 'reused';

/**
 * 提案の1件。提案が並べる献立1つぶんで、抱えるのは献立の識別子と由来だけである
 * （domain-model 4章 / ADR-008）。
 */
export type SuggestionEntry = {
  /** 生成の経路を1つに絞るための印。素のオブジェクトリテラルを SuggestionEntry として扱えなくする。 */
  readonly __brand: 'SuggestionEntry';
  readonly mealId: MealId;
  readonly origin: SuggestionEntryOrigin;
};

/**
 * 提案の1件を作る。
 *
 * 献立そのものは受け取らない。抱えるのは識別子と由来だけで、献立の中身に依らない
 * （ADR-008 / B-26 規則5）。
 */
export function createSuggestionEntry(props: {
  mealId: MealId;
  origin: SuggestionEntryOrigin;
}): SuggestionEntry {
  // 凍結する。提案は生成後に完全に不変（domain-model 4章）であり、可変にすると
  // 由来を混ぜない規則（C-15）を通らない状態を集約の外から作れてしまう。
  return Object.freeze({
    __brand: 'SuggestionEntry' as const,
    mealId: props.mealId,
    origin: props.origin,
  });
}
