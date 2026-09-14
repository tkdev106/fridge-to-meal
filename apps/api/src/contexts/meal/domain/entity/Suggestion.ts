import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';
import { MealRuleViolation } from '../error/MealRuleViolation.js';
import type { DateTime } from '../value/DateTime.js';
import type { PantrySnapshot } from '../value/PantrySnapshot.js';
import type { SuggestionEntry } from '../value/SuggestionEntry.js';
import type { SuggestionId } from '../value/SuggestionId.js';

/**
 * 提案。1回の提案で得た献立1〜3件と、そのときの在庫スナップショット。**集約ルート**
 * （domain-model 4章）。
 *
 * 不変条件（domain-model 4章 / B-26 7章）:
 * - `entries` は1件以上3件以下（C-15）
 * - `entries` に同じ `mealId` を2つ以上含めない（C-13）
 * - `entries` の `origin` は全件が同じ値（C-15 / ADR-022）
 * - 生成後は完全に不変。追記も削除もしない
 *
 * **`with*` を置かない。** 献立は調理記録が増えるので `withCookingRecord` があるが、
 * 提案は増やす入口を型として持たない。
 */
export type Suggestion = {
  /** 生成の経路を1つに絞るための印。素のオブジェクトリテラルを Suggestion として扱えなくする。 */
  readonly __brand: 'Suggestion';
  readonly id: SuggestionId;
  /** 所有する世帯。変える経路を置かないことで世帯の所属を固定する（C-9 / B-26 規則6）。 */
  readonly householdId: HouseholdId;
  readonly entries: readonly SuggestionEntry[];
  readonly pantrySnapshot: PantrySnapshot;
  readonly generatedAt: DateTime;
};

/** 1回の提案で並べる上限（C-15 / ADR-022 結果2）。下限は1件で、ちょうど3件ではない。 */
const MAX_ENTRIES = 3;

/**
 * 提案を作る。
 *
 * @throws {MealRuleViolation} 不変条件に反するとき
 */
export function createSuggestion(props: {
  id: SuggestionId;
  householdId: HouseholdId;
  entries: readonly SuggestionEntry[];
  pantrySnapshot: PantrySnapshot;
  generatedAt: DateTime;
}): Suggestion {
  // 件数 → 重複 → 由来 の順に見る（B-26 8章）。複数の規則に同時に反する入力で
  // どれが返るかは約束ではない — 順を決めるのは実装に選ばせないためである。
  if (props.entries.length === 0) {
    // 献立を1件も指さない提案は、提案として画面に出せない（C-15 / domain-model 4章）。
    throw new MealRuleViolation('suggestion.entries.empty', '提案の1件が1件もありません');
  }

  if (props.entries.length > MAX_ENTRIES) {
    // 1回の提案で出すのは3件まで（C-15 / ADR-022 結果2 — 件数の不変条件が「ちょうど3件」から緩んだ）。
    throw new MealRuleViolation('suggestion.entries.tooMany', '提案の1件が3件を超えています');
  }

  // 畳んだ数と件数を比べる。隣どうしの比較にすると、離れた位置にある同じ献立を
  // 黙って通してしまう（C-13 / B-26 規則2）。
  if (new Set(props.entries.map((entry) => entry.mealId)).size !== props.entries.length) {
    // 同じものが並ぶと、選べる献立が見かけより少なくなる（C-13）。
    throw new MealRuleViolation(
      'suggestion.entries.duplicateMeal',
      '提案が同じ献立を2つ以上含んでいます',
    );
  }

  // 由来が2種類あれば混在である。1つの提案は「作れる既存の献立」か「新しく生成した
  // もの」のどちらかであり、足りない分を生成で埋めない（C-15 / ADR-022 / B-26 規則3）。
  if (new Set(props.entries.map((entry) => entry.origin)).size > 1) {
    throw new MealRuleViolation(
      'suggestion.entries.mixedOrigin',
      '提案の1件の由来が混ざっています',
    );
  }

  // 参照する献立が同じ世帯かは確かめない。抱えるのは識別子だけで（ADR-008）、
  // 型として確かめる手立てが無い。同じ世帯のものを渡すのは呼ぶ側の責務である（B-26 規則5）。
  // 在庫スナップショットの中身も見ない — 在庫0件は正常な状態であり、そのとき生成を
  // 呼ばない判断は呼ぶ側にある（B-26 規則8 / 8章）。

  // 集約本体と、抱えている列を凍結する。提案は生成後に完全に不変（domain-model 4章）で、
  // 世帯を差し替える経路も置かない（C-9 / B-26 規則6）。受け取った配列は複製してから
  // 凍結する — 複製しないと、呼ぶ側が持ち続けている参照から不変条件を通らない変更が
  // 入る（先行 createMeal の B-14a 規則10）。
  return Object.freeze({
    __brand: 'Suggestion' as const,
    id: props.id,
    householdId: props.householdId,
    // 並べ替えない。C-12 の順に並べるのは呼ぶ側であり、ここで並べ替えると
    // 呼ぶ側が決めた順が黙って失われる（B-26 規則4 / ADR-036 決定4）。
    entries: Object.freeze([...props.entries]),
    pantrySnapshot: props.pantrySnapshot,
    generatedAt: props.generatedAt,
  });
}
