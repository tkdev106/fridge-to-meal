import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';
import type { Suggestion } from '../entity/Suggestion.js';
import type { DateTime } from '../value/DateTime.js';

/**
 * 提案の永続化の出口。**interface だけを置き、実装はインフラ層に持つ**（ADR-002 / C-14）。
 *
 * **全メソッドが `householdId` を必須引数に取る**（C-9 / B-27 規則1）。
 */
export interface SuggestionRepository {
  /**
   * 生成日時の新しい順に最大 `limit` 件を返す。同じ生成日時は `SuggestionId` の降順で
   * 閉じる（ADR-038）。C-11 の除外に使うため、**ここだけは順序を約束する** —
   * 先行 `StockItemRepository.findByHousehold` が約束しないのは**表示の並び**であり、
   * こちらは**選抜**だからである。限って取るには順序が要り、順序を約束しない `limit` は
   * 意味を持たない。**interface では強制できない約束なので、実装ごとにテストで確かめる**
   * （先行 `StockItemRepository.save` の `save.householdMismatch`）。
   *
   * **回数（C-11 の「直近3回」）は知らない。** `limit` として受け取るだけであり、
   * 3 を持つのは `SuggestMeals` である（ADR-038 決定3）。
   */
  findRecentByHousehold(householdId: HouseholdId, limit: number): Promise<Suggestion[]>;

  /**
   * 最新の提案1件を返す。1件も無ければ `null`（B-28 5章）。
   *
   * C-7 の比較に使う。**「最新」の決め方は `findRecentByHousehold` と同じ** — 生成日時の
   * 新しい順、同じ生成日時は `SuggestionId` の降順で閉じる（ADR-038 決定1・2）。1件に
   * 限って取る以上、順序を約束しないと**どの提案の在庫スナップショットと比べるかが
   * 実装ごとに変わる。** これも **interface では強制できない約束なので、実装ごとに
   * テストで確かめる**（先行 `StockItemRepository.save` の `save.householdMismatch`）。
   *
   * **見るのは最新の1件だけである**（C-7 の字面どおり）。2件前の提案の在庫と一致するかは
   * 問わない。何件遡るかを決めるのは C-11 の側であり、そちらは `findRecentByHousehold` が担う。
   */
  findLatestByHousehold(householdId: HouseholdId): Promise<Suggestion | null>;

  /**
   * 提案を保存する（C-14）。
   *
   * `suggestion.householdId` と引数の `householdId` が食い違う場合、実装は
   * **`MealRuleViolation`（`rule: 'save.householdMismatch'`）を投げて保存を拒む。**
   * 食い違いは呼び出し側の誤りであり、黙って引数の側に寄せない（先行
   * `StockItemRepository.save`）。これも interface では強制できない約束である。
   */
  save(householdId: HouseholdId, suggestion: Suggestion): Promise<void>;

  /**
   * 生成の由来を持つ提案の件数を返す（NFR-C2 / ADR-049 決定1）。1件も無ければ 0。
   *
   * **1日の生成回数の上限がこれを数える。** 数えたいのは**生成を呼んだ回数**であって提案の
   * 件数ではない — C-14 が再利用のみで組めた提案も保存させるため、**保存された提案をその
   * まま数えると、呼んでいない回まで上限を食う。** 由来で絞れるのは、C-15 が1つの提案の中で
   * 再利用と生成を混ぜないことを保証し、C-4c が「既存を参照しても `origin` は `'generated'`
   * のまま」と定めているからである。
   *
   * **数える条件は3つあり、どれも約束である**（interface では強制できないので、実装ごとに
   * テストで確かめる。先行 `save.householdMismatch` / ADR-038 結果2 / ADR-049 結果4）。
   *
   * - 引数の世帯の提案だけを数える（C-9）
   * - `entries` の `origin` が `'generated'` の提案だけを数える
   * - 生成日時が `since` **以降**の提案だけを数える。**下端は含む** — どちらに倒すかを
   *   約束しないと、ちょうど窓の下端に当たる回が実装ごとに数えられたり数えられなかったりする
   *
   * **「1日」の幅は知らない。** `since` として窓の下端を受け取るだけであり、24時間を持つのは
   * `SuggestMeals` である（ADR-049 決定2。ADR-038 決定3 が `limit` に対して置いた線と同じ）。
   *
   * **並び順は約束しない。** 返すのは件数だけで、どの提案を数えたかは外から見えない
   * （ADR-038 決定1 が順序を約束したのは、限って取る口だからである）。
   */
  countGeneratedByHouseholdSince(householdId: HouseholdId, since: DateTime): Promise<number>;
}
