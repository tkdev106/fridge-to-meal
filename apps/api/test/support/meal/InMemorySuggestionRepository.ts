import type { Suggestion } from '../../../src/contexts/meal/domain/entity/Suggestion.js';
import type { SuggestionRepository } from '../../../src/contexts/meal/domain/repository/SuggestionRepository.js';
import { MealRuleViolation } from '../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import type { DateTime } from '../../../src/contexts/meal/domain/value/DateTime.js';
import type { HouseholdId } from '../../../src/shared/domain/HouseholdId.js';

/**
 * 記憶の上だけで動く提案リポジトリ（B-27 設計書 8章）。先行は `InMemoryStockItemRepository.ts`。
 *
 * **interface では強制できない約束4つを、実装として持つのはここである**（B-27 5章 / 10章 /
 * B-28 5章 / ADR-049 結果4）。
 *
 * - `findRecentByHousehold` は生成日時の新しい順に最大 `limit` 件を返す。同じ生成日時は
 *   `SuggestionId` の降順で閉じる（C-11 の除外が同時刻の提案でぶれないため）
 * - `findLatestByHousehold` は**同じ順の先頭1件**を返す。1件も無ければ `null`
 *   （C-7 の比較の相手が実装ごとに変わらないため。ADR-038 決定1・2）
 * - `save` は引数の世帯と提案の世帯が食い違えば拒む（C-9 / 先行 `save.householdMismatch`）
 * - `countGeneratedByHouseholdSince` は**世帯・生成の由来・窓の下端（下端を含む）**の3つで
 *   絞って数える（NFR-C2 / ADR-049 決定1。どれが緩んでも上限が実装ごとに変わる）
 *
 * **同じ識別子の2度目の `save` は、世帯を問わず拒んで何も積まない**（B-57 規則2・3 /
 * ADR-058 決定1）。本物は主キーが表全体で一意なので、他世帯と識別子が衝突した回も DB が
 * 拒む。差し替えが黙って積むと、単体テストの上だけで「同じ提案を2度積める」が通る。
 * 中身が同じでも違っても拒み、べき等に通す経路は持たない（ADR-058 比較した案 1-B）。
 * **失敗の形は本物に揃えない** — 本物は `rule` を持たない DB の失敗を投げるが、interface は
 * 失敗の型を約束しておらず、差し替えは `MealRuleViolation('save.duplicateId')` で足りる。
 * 世帯の食い違いを先に見る（C-9。世帯分離の断りを識別子の重複より優先する）。
 */
export class InMemorySuggestionRepository implements SuggestionRepository {
  readonly #stored: Suggestion[] = [];
  readonly #findRecentThrows: Error | null;
  readonly #findLatestThrows: Error | null;

  /**
   * `findRecentThrows` を渡すと `findRecentByHousehold` が、`findLatestThrows` を
   * 渡すと `findLatestByHousehold` が、保存済みを返さずにそれを投げる。**取得の失敗を
   * 握りつぶさず呼び出し側へ伝えること**（B-27 7章2行目 / B-28 7章2行目）を確かめるための
   * 口である。省略すれば保存済みを返す（既定の振る舞い）。
   *
   * **口を2つに分けてあるのは、投げる位置が呼ぶ側の経路の別々の場所にあるからである。**
   * 1つにまとめると、C-7 の短絡が最新の提案を引く時点で投げてしまい、その先にある
   * `findRecentByHousehold`（C-11 の除外の材料）の伝播を確かめられなくなる。
   */
  constructor(props: { findRecentThrows?: Error; findLatestThrows?: Error } = {}) {
    this.#findRecentThrows = props.findRecentThrows ?? null;
    this.#findLatestThrows = props.findLatestThrows ?? null;
  }

  async findRecentByHousehold(householdId: HouseholdId, limit: number): Promise<Suggestion[]> {
    if (this.#findRecentThrows !== null) throw this.#findRecentThrows;

    // 濾した結果は新しい配列なので、並べ替えても保存済みの並びは動かない。
    return this.#stored
      .filter((suggestion) => suggestion.householdId === householdId)
      .sort(byNewestFirst)
      .slice(0, limit);
  }

  async findLatestByHousehold(householdId: HouseholdId): Promise<Suggestion | null> {
    if (this.#findLatestThrows !== null) throw this.#findLatestThrows;

    // 並べ方は `findRecentByHousehold` と同じ1つの述語に任せる。別に書くと、同じ生成日時の
    // 決着（`SuggestionId` の降順）が2か所に散り、片方だけ動いたときに C-7 と C-11 が
    // 別々の提案を見る（B-28 5章）。世帯で濾すのも同じである（C-9）。
    return (
      this.#stored
        .filter((suggestion) => suggestion.householdId === householdId)
        .sort(byNewestFirst)[0] ?? null
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
    if (this.#stored.some((stored) => stored.id === suggestion.id)) {
      // 世帯を問わず見る。本物の主キーは表全体で一意である（ADR-058 決定1）。
      throw new MealRuleViolation('save.duplicateId', '同じ識別子の提案が保存済みである');
    }
    this.#stored.push(suggestion);
  }

  async countGeneratedByHouseholdSince(householdId: HouseholdId, since: DateTime): Promise<number> {
    // 絞るのは世帯・由来・窓の下端の3つである（ADR-049 決定1・決定2）。**下端は含む** —
    // ちょうど24時間前に呼んだ回を、実装ごとに数えたり数えなかったりさせない。
    // `DateTime` は UTC の正準形なので、文字列の大小がそのまま時刻の順になる。
    return this.#stored.filter(
      (suggestion) =>
        suggestion.householdId === householdId &&
        isGenerated(suggestion) &&
        suggestion.generatedAt >= since,
    ).length;
  }
}

/**
 * その提案が生成の経路から来たかを返す（ADR-049 決定1 / C-15 / C-4c）。
 *
 * **見るのは先頭の1件で足りる。** `createSuggestion` が「`entries` は1件以上」と
 * 「`origin` は全件が同じ値」を不変条件として守っているためである（C-15）。
 */
function isGenerated(suggestion: Suggestion): boolean {
  return suggestion.entries[0]?.origin === 'generated';
}

/** 生成日時の新しい順。同じ生成日時は `SuggestionId` の降順で閉じる（B-27 10章）。 */
function byNewestFirst(leftSuggestion: Suggestion, rightSuggestion: Suggestion): number {
  // `DateTime` は UTC の正準形なので、文字列の大小がそのまま時刻の順になる。
  const generatedAtOrder = compareCodeUnits(
    rightSuggestion.generatedAt,
    leftSuggestion.generatedAt,
  );
  if (generatedAtOrder !== 0) return generatedAtOrder;

  return compareCodeUnits(rightSuggestion.id, leftSuggestion.id);
}

/** コード単位の大小で比べる（照合順序が実行環境の ICU に依らないようにする）。 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
