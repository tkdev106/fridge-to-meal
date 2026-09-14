import type { Meal } from '../../../src/contexts/meal/domain/entity/Meal.js';
import type { MealRepository } from '../../../src/contexts/meal/domain/repository/MealRepository.js';
import { MealRuleViolation } from '../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/** 何件目の保存で何を投げるか。先行の `投げる例外` と同じ、決まった応答の持たせ方である。 */
export type 保存の失敗 = {
  readonly 何件目の保存で投げるか: number;
  readonly 投げる例外: Error;
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
 * **保存の失敗は `保存が途中で投げるもの` で注入する**（B-28 7章4行目）。先行の
 * `記憶上の在庫品の一覧`（`投げる例外`）と `記憶上の提案リポジトリ`（`直近の取得が投げる例外`）と
 * 同じ筋で、決まった応答を持たせるだけである。**可変長の構築は壊さない** — 前提の献立を置く
 * 口はそのままで、失敗の設定だけを別の入口から受け取る。
 *
 * 同じ識別子の献立でも置き換えない。献立は生成後に編集できず（C-3）、同じ識別子が2度
 * 発行されるのは発行器の誤りである（先行 `記憶上の提案リポジトリ`）。
 *
 * **`findByHousehold` は世帯ごとの配列を毎回同じ参照で返す。** 複製して返すと、呼ぶ側が
 * 受け取った列をその場で並べ替えていても気づけない（B-27 規則17 / ADR-009）。世帯で分けて
 * 持つのは、「その世帯の献立をすべて返す」という約束から外れた実装をテストの側に作らない
 * ためである（先行 `ListStockItems.test.ts` の同じ配列を返す記憶上の実装）。
 */
export class 記憶上の献立リポジトリ implements MealRepository {
  readonly #世帯ごとの保存済み = new Map<HouseholdId, Meal[]>();
  #保存の回数 = 0;
  #保存が投げる: 保存の失敗 | null = null;

  constructor(...献立たち: readonly Meal[]) {
    // 世帯は献立自身が持つものだけで決める。引数で別に受け取ると、献立の世帯と
    // 置き場所が食い違う状態をテストの側に作れてしまう（C-9）。
    for (const 献立 of 献立たち) this.#その世帯の配列(献立.householdId).push(献立);
  }

  /**
   * **何件目の `save` で投げるか**を決めた記憶上の献立リポジトリを作る（B-28 7章4行目）。
   *
   * 1件目を保存した後に2件目が落ちる、という途中での失敗を作れる入口である。数えるのは
   * 呼ばれた回数であり、投げた回も1件に数える。
   */
  static 保存が途中で投げるもの(
    保存が投げる: 保存の失敗,
    ...献立たち: readonly Meal[]
  ): 記憶上の献立リポジトリ {
    const リポジトリ = new 記憶上の献立リポジトリ(...献立たち);
    リポジトリ.#保存が投げる = 保存が投げる;
    return リポジトリ;
  }

  #その世帯の配列(householdId: HouseholdId): Meal[] {
    const 既存 = this.#世帯ごとの保存済み.get(householdId);
    if (既存 !== undefined) return 既存;

    const 新しい配列: Meal[] = [];
    this.#世帯ごとの保存済み.set(householdId, 新しい配列);
    return 新しい配列;
  }

  async findByHousehold(householdId: HouseholdId): Promise<Meal[]> {
    return this.#その世帯の配列(householdId);
  }

  async save(householdId: HouseholdId, meal: Meal): Promise<void> {
    this.#保存の回数 += 1;

    if (meal.householdId !== householdId) {
      // 世帯が違えば保存を拒む。ここを緩めると世帯分離が破れる（C-9）。
      throw new MealRuleViolation(
        'save.householdMismatch',
        '引数の世帯と献立の世帯が食い違っている',
      );
    }

    const 保存が投げる = this.#保存が投げる;
    if (保存が投げる !== null && 保存が投げる.何件目の保存で投げるか === this.#保存の回数) {
      // 用意した回だけ落ちる。それより前の回で積んだ献立はそのまま残る（B-28 7章4行目）。
      throw 保存が投げる.投げる例外;
    }
    this.#その世帯の配列(householdId).push(meal);
  }
}
