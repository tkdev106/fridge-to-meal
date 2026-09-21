/* eslint-disable @typescript-eslint/no-unused-vars -- 署名だけの雛形。引数は
   `MealRepository` の約束そのものなので `_` を付けて改名しない（実装が入れば使われる）。 */
import type { Meal } from '../domain/entity/Meal.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { HouseholdTransaction } from './db/HouseholdTransaction.js';

/**
 * `MealRepository` の実装（B-44 設計 4章・5章）。
 *
 * **トランザクションを開かず、接続も作らず、`set local` も張らない**（設計 規則1 /
 * ADR-029 決定3(a)）。受け取った1つの handle の上でだけ問い合わせる。
 *
 * **署名だけの雛形である**（`docs/testing.md` 8章）。振る舞いは
 * `apps/api/test/db/mealRepository.test.ts` が定めており、実装は `implementer` が書く。
 */
export class MealRepositoryImpl implements MealRepository {
  constructor(private readonly tx: HouseholdTransaction) {}

  /**
   * その世帯の献立をすべて返す。0行なら空の配列で、`null` にも例外にもしない（設計 7章）。
   *
   * **引数の世帯で必ず絞る**（設計 規則2 / C-9）。集約の中の並びだけは約束する
   * （材料・手順・調理記録は `position` の昇順。設計 規則4）。
   */
  findByHousehold(householdId: HouseholdId): Promise<Meal[]> {
    throw new Error('未実装');
  }

  /**
   * 献立を保存する（C-1）。
   *
   * 引数の世帯と献立の世帯が食い違えば `save.householdMismatch`、保存済みの献立と
   * 名称・材料・手順が食い違えば `save.contentMismatch` で断り、**1行も書かない**
   * （設計 規則8・9 と 7章 / C-3）。
   */
  save(householdId: HouseholdId, meal: Meal): Promise<void> {
    throw new Error('未実装');
  }
}
