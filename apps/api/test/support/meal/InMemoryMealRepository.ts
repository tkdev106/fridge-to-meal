import type { Meal } from '../../../src/contexts/meal/domain/entity/Meal.js';
import type { MealRepository } from '../../../src/contexts/meal/domain/repository/MealRepository.js';
import { MealRuleViolation } from '../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import type { CookingRecord } from '../../../src/contexts/meal/domain/value/CookingRecord.js';
import type { CookingStep } from '../../../src/contexts/meal/domain/value/CookingStep.js';
import type { MealId } from '../../../src/contexts/meal/domain/value/MealId.js';
import type { MealIngredient } from '../../../src/contexts/meal/domain/value/MealIngredient.js';
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
 * **同じ世帯に同じ識別子の献立が保存済みなら、読み比べてから置き換える**（B-57 規則5〜10 /
 * ADR-057 決定1・2）。名称・材料（件数・並び・名称・種別・分量）・手順（件数・並び・本文）が
 * 一致し、保存済みの調理記録が渡された記録の先頭からの並びであれば、その位置の要素を
 * 置き換える（同じ内容＋記録の追加はべき等に通る。`AddCookingRecord` の経路）。1つでも
 * 食い違えば `save.contentMismatch` で拒み、置き換えも積みもしない。差し替えがこれを
 * 持たないと、単体テストの上だけで「生成後に編集できる」が通る（C-3）。
 *
 * 読み比べの相手は**同じ世帯の箱の中だけ**である（C-9。本物も世帯で絞って読む）。
 * **他世帯と識別子が衝突した保存は拒まない** — 本物は親の主キーが DB の失敗として拒むので、
 * ここだけはまだ本物より甘い（B-57 で範囲の外に置いた。発行器が識別子を重複させない限り起こらない）。
 * **生成日時は比べない**（ADR-057 結果3）。生成日時だけが違う保存は通って置き換わり、
 * 本物（最初の値が残る）とはそこだけ食い違う — アプリの経路からは起こらない割り切りである。
 * 判定の順は「世帯の食い違い → `withSaveFailure` の注入 → 読み比べ」で、注入の回数は
 * 読み比べで拒んだ回も含めて呼ばれた回数で数える（B-57 規則4）。
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

    const stored = this.#arrayOf(householdId);
    const storedIndex = stored.findIndex((candidate) => candidate.id === meal.id);
    const storedMeal = stored[storedIndex];
    if (storedMeal === undefined) {
      stored.push(meal);
      return;
    }

    // 拒む回は保存済みを動かさない（ADR-057 決定1「1行も書かない」）。
    if (!sameContent(storedMeal, meal)) {
      throw new MealRuleViolation(
        'save.contentMismatch',
        '保存済みの献立と名称・材料・手順が食い違っている',
      );
    }
    if (!isPrefixOfCookingRecords(storedMeal.cookingRecords, meal.cookingRecords)) {
      throw new MealRuleViolation(
        'save.contentMismatch',
        '保存済みの調理記録が、渡された調理記録の先頭からの並びになっていない',
      );
    }

    // `findByHousehold` が世帯ごとに同じ配列参照を返す性質を保つため、配列を作り直さず
    // in-place で入れ替える。
    stored[storedIndex] = meal;
  }
}

/**
 * 名称・材料・手順が**件数と並び順を含めて**値として同じか（ADR-057 決定1）。生成日時は
 * 比べない（ADR-057 結果3）。参照で比べると、`withCookingRecord` が作り直した献立を拒む。
 */
function sameContent(storedMeal: Meal, meal: Meal): boolean {
  return (
    storedMeal.title === meal.title &&
    sameIngredients(storedMeal.ingredients, meal.ingredients) &&
    sameSteps(storedMeal.steps, meal.steps)
  );
}

/** 材料が件数と並び順を含めて、名称・種別・分量（`null` は `null` とだけ一致）で同じか。 */
function sameIngredients(
  storedIngredients: readonly MealIngredient[],
  ingredients: readonly MealIngredient[],
): boolean {
  return (
    storedIngredients.length === ingredients.length &&
    storedIngredients.every((storedIngredient, position) => {
      const ingredient = ingredients[position];
      return (
        ingredient !== undefined &&
        storedIngredient.name === ingredient.name &&
        storedIngredient.kind === ingredient.kind &&
        storedIngredient.amount === ingredient.amount
      );
    })
  );
}

/** 手順が件数と並び順を含めて本文で同じか。 */
function sameSteps(storedSteps: readonly CookingStep[], steps: readonly CookingStep[]): boolean {
  return (
    storedSteps.length === steps.length &&
    storedSteps.every((storedStep, position) => storedStep === steps[position])
  );
}

/**
 * 保存済みの調理記録が、渡された記録の**先頭からの並び**になっているか（ADR-057 決定2 / C-3）。
 * 記録は追加のみなので、減ることも途中が違うことも起こらない。
 */
function isPrefixOfCookingRecords(
  storedRecords: readonly CookingRecord[],
  records: readonly CookingRecord[],
): boolean {
  return (
    storedRecords.length <= records.length &&
    storedRecords.every(
      (storedRecord, position) => storedRecord.cookedAt === records[position]?.cookedAt,
    )
  );
}
