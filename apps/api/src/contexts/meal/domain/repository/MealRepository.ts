import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';
import type { Meal } from '../entity/Meal.js';
import type { MealId } from '../value/MealId.js';

/**
 * 献立の永続化の出口。**interface だけを置き、実装はインフラ層に持つ**（ADR-002）。
 *
 * **全メソッドが `householdId` を必須引数に取る**（C-9 / B-27 規則1）。世帯をまたぐ取得を
 * 型として不可能にするためであり、**献立自身が `householdId` を持っていても省かない**
 * （先行 `StockItemRepository`）。
 *
 * 献立を作るのは生成の経路だけなので、`save` は生成の経路と同じ周（B-28）で足した。
 */
export interface MealRepository {
  /**
   * その世帯の献立をすべて返す。
   *
   * **並び順を約束しない**（先行 `StockItemRepository.findByHousehold`）。再利用の並びは
   * C-12 が決めるものであり、決めるのは `cookableMealsOf` である（ADR-036 決定4）。
   */
  findByHousehold(householdId: HouseholdId): Promise<Meal[]>;

  /**
   * その世帯の献立を識別子で1件引く。**無ければ `null` を返す**（例外にしない）。
   *
   * **世帯と識別子の両方で絞る**（C-9 / ADR-067 論点2）。**他世帯の献立を指した回も
   * `null` である** — 「他世帯のものだ」と区別して返すと、識別子を総当たりする者に
   * 他世帯の献立の存在が漏れる（NFR-09）。**interface では強制できない約束なので、
   * 実装ごとにテストで確かめる。**
   */
  findById(householdId: HouseholdId, mealId: MealId): Promise<Meal | null>;

  /**
   * 献立を保存する（C-1。生成結果を献立に変換した時点で保存する）。
   *
   * `meal.householdId` と引数の `householdId` が食い違う場合、実装は
   * **`MealRuleViolation`（`rule: 'save.householdMismatch'`）を投げて保存を拒む。**
   * 食い違いは呼び出し側の誤りであり、黙って引数の側に寄せない（先行
   * `StockItemRepository.save` / `SuggestionRepository.save`）。**interface では強制できない
   * 約束なので、実装ごとにテストで確かめる。**
   *
   * **同じ識別子で保存済みの献立と内容が食い違う保存も拒む**（**ADR-057** / C-3）。
   * 献立は生成後に編集できない以上、名称・材料・手順は**件数と並び順を含めて**一致して
   * いなければならず、調理記録は**保存済みが渡された記録の先頭からの並び**になっていな
   * ければならない（追加のみ）。1つでも違えば実装は **`MealRuleViolation`
   * （`rule: 'save.contentMismatch'`）を投げ、1行も書かない。** 黙って無視すると、
   * 件数の変わる保存が**1度目にも2度目にも無い内容**を残しうる — 子表の主キーが
   * `(meal_id, position)` であるため、増えた位置の行だけが入ってしまう（ADR-057 状況）。
   *
   * **同じ内容の保存はそのまま通る**（べき等）。`withCookingRecord` で記録を1件足した
   * 献立の保存がこれに乗り、増えた記録だけが足される。**これも interface では強制できない
   * 約束なので、実装ごとにテストで確かめる。**
   */
  save(householdId: HouseholdId, meal: Meal): Promise<void>;
}
