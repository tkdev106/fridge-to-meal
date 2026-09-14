import type { Meal } from '../../../src/contexts/meal/domain/entity/Meal.js';
import type { MealRepository } from '../../../src/contexts/meal/domain/repository/MealRepository.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 記憶の上だけで動く献立リポジトリ（B-27 設計書 8章）。**interface が実装できる形を
 * していること**の確認を兼ねている。先行は `InMemoryStockItemRepository.ts`。
 *
 * `test/` に閉じてあるのは、`src/` に置くと Worker の成果物に載り、`infrastructure/` に
 * 置くと本物の実装と並んで結線の誤りに気づけなくなるためである（`docs/testing.md` 6章）。
 *
 * 献立を置く口は**コンストラクタだけ**である。`MealRepository` に `save` が無い（作るのは
 * 生成の経路だけで、それは B-28）ため、前提の献立は interface の外から置く。
 *
 * **`findByHousehold` は世帯ごとの配列を毎回同じ参照で返す。** 複製して返すと、呼ぶ側が
 * 受け取った列をその場で並べ替えていても気づけない（B-27 規則17 / ADR-009）。世帯で分けて
 * 持つのは、「その世帯の献立をすべて返す」という約束から外れた実装をテストの側に作らない
 * ためである（先行 `ListStockItems.test.ts` の同じ配列を返す記憶上の実装）。
 */
export class 記憶上の献立リポジトリ implements MealRepository {
  readonly #世帯ごとの保存済み = new Map<HouseholdId, Meal[]>();

  constructor(...献立たち: readonly Meal[]) {
    // 世帯は献立自身が持つものだけで決める。引数で別に受け取ると、献立の世帯と
    // 置き場所が食い違う状態をテストの側に作れてしまう（C-9）。
    for (const 献立 of 献立たち) this.#その世帯の配列(献立.householdId).push(献立);
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
}
