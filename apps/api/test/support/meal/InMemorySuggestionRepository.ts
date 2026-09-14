import type { Suggestion } from '../../../src/contexts/meal/domain/entity/Suggestion.js';
import type { SuggestionRepository } from '../../../src/contexts/meal/domain/repository/SuggestionRepository.js';
import { MealRuleViolation } from '../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 記憶の上だけで動く提案リポジトリ（B-27 設計書 8章）。先行は `InMemoryStockItemRepository.ts`。
 *
 * **interface では強制できない約束3つを、実装として持つのはここである**（B-27 5章 / 10章 /
 * B-28 5章）。
 *
 * - `findRecentByHousehold` は生成日時の新しい順に最大 `limit` 件を返す。同じ生成日時は
 *   `SuggestionId` の降順で閉じる（C-11 の除外が同時刻の提案でぶれないため）
 * - `findLatestByHousehold` は**同じ順の先頭1件**を返す。1件も無ければ `null`
 *   （C-7 の比較の相手が実装ごとに変わらないため。ADR-038 決定1・2）
 * - `save` は引数の世帯と提案の世帯が食い違えば拒む（C-9 / 先行 `save.householdMismatch`）
 *
 * 同じ識別子の提案でも置き換えない。提案は生成後に不変で（C-3 と同じ筋）、同じ識別子が
 * 2度発行されるのは発行器の誤りである。
 */
export class 記憶上の提案リポジトリ implements SuggestionRepository {
  readonly #保存済み: Suggestion[] = [];
  readonly #直近の取得が投げる例外: Error | null;
  readonly #最新の取得が投げる例外: Error | null;

  /**
   * `直近の取得が投げる例外` を渡すと `findRecentByHousehold` が、`最新の取得が投げる例外` を
   * 渡すと `findLatestByHousehold` が、保存済みを返さずにそれを投げる。**取得の失敗を
   * 握りつぶさず呼び出し側へ伝えること**（B-27 7章2行目 / B-28 7章2行目）を確かめるための
   * 口である。省略すれば保存済みを返す（既定の振る舞い）。
   *
   * **口を2つに分けてあるのは、投げる位置が呼ぶ側の経路の別々の場所にあるからである。**
   * 1つにまとめると、C-7 の短絡が最新の提案を引く時点で投げてしまい、その先にある
   * `findRecentByHousehold`（C-11 の除外の材料）の伝播を確かめられなくなる。
   */
  constructor(props: { 直近の取得が投げる例外?: Error; 最新の取得が投げる例外?: Error } = {}) {
    this.#直近の取得が投げる例外 = props.直近の取得が投げる例外 ?? null;
    this.#最新の取得が投げる例外 = props.最新の取得が投げる例外 ?? null;
  }

  async findRecentByHousehold(householdId: HouseholdId, limit: number): Promise<Suggestion[]> {
    if (this.#直近の取得が投げる例外 !== null) throw this.#直近の取得が投げる例外;

    // 濾した結果は新しい配列なので、並べ替えても保存済みの並びは動かない。
    return this.#保存済み
      .filter((提案) => 提案.householdId === householdId)
      .sort(新しい順)
      .slice(0, limit);
  }

  async findLatestByHousehold(householdId: HouseholdId): Promise<Suggestion | null> {
    if (this.#最新の取得が投げる例外 !== null) throw this.#最新の取得が投げる例外;

    // 並べ方は `findRecentByHousehold` と同じ1つの述語に任せる。別に書くと、同じ生成日時の
    // 決着（`SuggestionId` の降順）が2か所に散り、片方だけ動いたときに C-7 と C-11 が
    // 別々の提案を見る（B-28 5章）。世帯で濾すのも同じである（C-9）。
    return (
      this.#保存済み.filter((提案) => 提案.householdId === householdId).sort(新しい順)[0] ?? null
    );
  }

  async save(householdId: HouseholdId, suggestion: Suggestion): Promise<void> {
    if (suggestion.householdId !== householdId) {
      // 世帯が違えば保存を拒む。ここを緩めると世帯分離が破れる（C-9）。
      throw new MealRuleViolation(
        'save.householdMismatch',
        '引数の世帯と提案の世帯が食い違っている',
      );
    }
    this.#保存済み.push(suggestion);
  }
}

/** 生成日時の新しい順。同じ生成日時は `SuggestionId` の降順で閉じる（B-27 10章）。 */
function 新しい順(左: Suggestion, 右: Suggestion): number {
  // `DateTime` は UTC の正準形なので、文字列の大小がそのまま時刻の順になる。
  const 生成日時の差 = コード単位で比べる(右.generatedAt, 左.generatedAt);
  if (生成日時の差 !== 0) return 生成日時の差;

  return コード単位で比べる(右.id, 左.id);
}

/** コード単位の大小で比べる（照合順序が実行環境の ICU に依らないようにする）。 */
function コード単位で比べる(左: string, 右: string): number {
  if (左 < 右) return -1;
  if (左 > 右) return 1;
  return 0;
}
