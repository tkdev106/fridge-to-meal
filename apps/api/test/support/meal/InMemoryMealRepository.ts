import type { Meal } from '../../../src/contexts/meal/domain/entity/Meal.js';
import type { MealRepository } from '../../../src/contexts/meal/domain/repository/MealRepository.js';
import { MealRuleViolation } from '../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import type { MealId } from '../../../src/contexts/meal/domain/value/MealId.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/** 何件目の保存で何を投げるか。先行の `throws` と同じ、決まった応答の持たせ方である。 */
export type SaveFailure = {
  readonly onSaveNumber: number;
  readonly throws: Error;
};

/**
 * 記憶の上だけで動く献立リポジトリ（B-27 設計書 8章）。**interface が実装できる形を
 * していること**の確認を兼ねている。先行は `InMemoryStockItemRepository.ts`。
 *
 * `test/` に閉じてあるのは、`src/` に置くと Worker の成果物に載り、`infrastructure/` に
 * 置くと本物の実装と並んで結線の誤りに気づけなくなるためである（`docs/testing.md` 6章）。
 *
 * 前提の献立はコンストラクタで置く。`save` を通さないのは、生成の経路を通らずに
 * 「すでに保持している献立」を用意するためである。
 *
 * **interface では強制できない約束を、実装として持つのはここである**（B-28 5章 / 7章3行目）。
 *
 * - `save` は引数の世帯と献立の世帯が食い違えば拒む（C-9 / 先行 `save.householdMismatch`）
 *
 * **保存の失敗は `withSaveFailure` で注入する**（B-28 7章4行目）。先行の
 * `FixedListStockItems`（`throws`）と `InMemorySuggestionRepository`（`findRecentThrows`）と
 * 同じ筋で、決まった応答を持たせるだけである。**可変長の構築は壊さない** — 前提の献立を置く
 * 口はそのままで、失敗の設定だけを別の入口から受け取る。
 *
 * **同じ世帯に同じ識別子の献立が保存済みなら、その位置の要素を置き換える**（B-51 1周目）。
 * 押し込むと、記録を1件足した保存のあと `findByHousehold` が同じ識別子の献立を2件返し、
 * 本物（`MealRepositoryImpl`）では通る振る舞い（ADR-057 決定1・決定2 の「同じ内容＋記録の
 * 追加はべき等に通り、増えた記録だけが足される」）が**二重の側の事情で観察できなくなる。**
 *
 * **読み比べ（`save.contentMismatch`）は二重に持ち込まない。** 本物の読み比べは DB の
 * テストが押さえており、必要な回は `withSaveFailure` で注入する。**二重の側の約束を
 * どこまで本物に揃えるかは B-57 が持つ** — この周は「同じ識別子の2度目が置き換わること」
 * だけを揃えている。
 *
 * **`findByHousehold` は世帯ごとの配列を毎回同じ参照で返す。** 複製して返すと、呼ぶ側が
 * 受け取った列をその場で並べ替えていても気づけない（B-27 規則17 / ADR-009）。世帯で分けて
 * 持つのは、「その世帯の献立をすべて返す」という約束から外れた実装をテストの側に作らない
 * ためである（先行 `ListStockItems.test.ts` の同じ配列を返す記憶上の実装）。
 */
export class InMemoryMealRepository implements MealRepository {
  readonly #storedByHousehold = new Map<HouseholdId, Meal[]>();
  #saveCount = 0;
  #saveFailure: SaveFailure | null = null;

  constructor(...meals: readonly Meal[]) {
    // 世帯は献立自身が持つものだけで決める。引数で別に受け取ると、献立の世帯と
    // 置き場所が食い違う状態をテストの側に作れてしまう（C-9）。
    for (const meal of meals) this.#arrayOf(meal.householdId).push(meal);
  }

  /**
   * **何件目の `save` で投げるか**を決めた記憶上の献立リポジトリを作る（B-28 7章4行目）。
   *
   * 1件目を保存した後に2件目が落ちる、という途中での失敗を作れる入口である。数えるのは
   * 呼ばれた回数であり、投げた回も1件に数える。
   */
  static withSaveFailure(
    saveFailure: SaveFailure,
    ...meals: readonly Meal[]
  ): InMemoryMealRepository {
    const repository = new InMemoryMealRepository(...meals);
    repository.#saveFailure = saveFailure;
    return repository;
  }

  #arrayOf(householdId: HouseholdId): Meal[] {
    const existing = this.#storedByHousehold.get(householdId);
    if (existing !== undefined) return existing;

    const created: Meal[] = [];
    this.#storedByHousehold.set(householdId, created);
    return created;
  }

  async findByHousehold(householdId: HouseholdId): Promise<Meal[]> {
    return this.#arrayOf(householdId);
  }

  /**
   * その世帯の献立を識別子で1件引く（B-52 / C-9）。無ければ `null`。
   *
   * **世帯の箱の中だけを探す。** 他世帯の献立を指した回も `null` であり、「他世帯のものだ」
   * と区別して返さない（NFR-09。本物の `MealRepositoryImpl` と同じ約束）。
   */
  async findById(householdId: HouseholdId, mealId: MealId): Promise<Meal | null> {
    return this.#arrayOf(householdId).find((candidate) => candidate.id === mealId) ?? null;
  }

  async save(householdId: HouseholdId, meal: Meal): Promise<void> {
    this.#saveCount += 1;

    if (meal.householdId !== householdId) {
      // 世帯が違えば保存を拒む。ここを緩めると世帯分離が破れる（C-9）。
      throw new MealRuleViolation(
        'save.householdMismatch',
        '引数の世帯と献立の世帯が食い違っている',
      );
    }

    const saveFailure = this.#saveFailure;
    if (saveFailure !== null && saveFailure.onSaveNumber === this.#saveCount) {
      // 用意した回だけ落ちる。それより前の回で積んだ献立はそのまま残る（B-28 7章4行目）。
      throw saveFailure.throws;
    }

    // 同じ識別子が保存済みなら、その位置で置き換える。`findByHousehold` が世帯ごとに
    // 同じ配列参照を返す性質を保つため、配列を作り直さず in-place で入れ替える。
    const stored = this.#arrayOf(householdId);
    const storedIndex = stored.findIndex((candidate) => candidate.id === meal.id);
    if (storedIndex === -1) {
      stored.push(meal);
      return;
    }
    stored[storedIndex] = meal;
  }
}
