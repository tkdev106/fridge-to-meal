import { describe, expect, it } from 'vitest';
import { createSuggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import type { Suggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { createSuggestionEntry } from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import type {
  SuggestionEntry,
  SuggestionEntryOrigin,
} from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import { suggestionIdOf } from '../../../../src/contexts/meal/domain/value/SuggestionId.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { createPantrySnapshot } from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
import { createStockItem } from '../../../../src/contexts/meal/domain/value/StockItem.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { expiryDateOf } from '../../../../src/contexts/meal/domain/value/ExpiryDate.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';

const suggestionId = '33333333-3333-4333-8333-333333333333';
const householdId = '11111111-1111-4111-8111-111111111111';
const generatedAt = '2026-09-13T12:00:00Z';
const pantrySnapshot = createPantrySnapshot({
  stockItems: [
    createStockItem({ name: 'にんじん', amount: amountOf(null), expiryDate: expiryDateOf(null) }),
  ],
});

/** 提案の1件。本題は献立の識別子と由来だけなので、この2つだけを受け取る。 */
function suggestionEntry(mealId: string, origin: SuggestionEntryOrigin = 'generated') {
  return createSuggestionEntry({ mealId: mealIdOf(mealId), origin });
}

/** 本題でない値を隠して提案を作る。既定は生成の由来の1件だけを持つ姿。 */
function suggestion(overrides: Partial<Parameters<typeof createSuggestion>[0]> = {}) {
  return createSuggestion({
    id: suggestionIdOf(suggestionId),
    householdId: householdIdOf(householdId),
    entries: [suggestionEntry('m-1')],
    pantrySnapshot,
    generatedAt: dateTimeOf(generatedAt),
    ...overrides,
  });
}

/** 抱えている提案の1件が指す献立の識別子を、並びのまま取り出す。 */
function mealIdsOf(suggestion: Suggestion) {
  return suggestion.entries.map((entry) => entry.mealId);
}

describe('提案 Suggestion', () => {
  it('識別子・世帯・提案の1件の列・在庫スナップショット・生成日時を持つ', () => {
    // domain-model 4章: 集約が持つ項目。generatedAt は最新の提案を選ぶ鍵でもある（C-7）。
    const created = suggestion({
      entries: [suggestionEntry('m-1')],
      pantrySnapshot,
      generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
    });

    expect(created.id).toBe(suggestionId);
    expect(created.householdId).toBe(householdId);
    expect(created.entries.length).toBe(1);
    expect(created.pantrySnapshot).toEqual(pantrySnapshot);
    expect(created.generatedAt).toBe('2026-09-13T12:00:00.000Z');
  });

  it('提案の1件が1件だけの提案を作れる', () => {
    // C-15 / ADR-022 結果3 / FR-16: 件数は「ちょうど3件」ではなく1件以上3件以下。
    // 再利用で1件しか組めなくても、その1件で提案になる。
    expect(suggestion({ entries: [suggestionEntry('m-1')] }).entries.length).toBe(1);
  });

  it('提案の1件が3件の提案を作れる', () => {
    // C-15 / B-26 規則1: 上限は3件。境界のこちら側は通る。
    const created = suggestion({
      entries: [suggestionEntry('m-1'), suggestionEntry('m-2'), suggestionEntry('m-3')],
    });

    expect(created.entries.length).toBe(3);
  });

  it('提案の1件が0件の提案を許さない', () => {
    // C-15 / B-26 規則1: 献立を1件も指さない提案は、提案として画面に出せない。
    expect(() => suggestion({ entries: [] })).toThrow(MealRuleViolation);
  });

  it('提案の1件が0件の規則違反は識別子から判別できる', () => {
    // ADR-025 / B-26 8章: 反した規則は識別子で持つ。文言ではなく rule で分岐できること。
    expect(() => suggestion({ entries: [] })).toThrow(
      expect.objectContaining({ rule: 'suggestion.entries.empty' }),
    );
  });

  it('提案の1件が4件の提案を許さない', () => {
    // C-15 / B-26 規則1: 上限は3件。境界の向こう側は通らない。
    expect(() =>
      suggestion({
        entries: [
          suggestionEntry('m-1'),
          suggestionEntry('m-2'),
          suggestionEntry('m-3'),
          suggestionEntry('m-4'),
        ],
      }),
    ).toThrow(MealRuleViolation);
  });

  it('提案の1件が多すぎる規則違反は、0件の違反と識別子で見分けられる', () => {
    // ADR-025 / B-26 8章: 直し方が違う2つの違反を、呼ぶ側が rule で見分けられること。
    expect(() =>
      suggestion({
        entries: [
          suggestionEntry('m-1'),
          suggestionEntry('m-2'),
          suggestionEntry('m-3'),
          suggestionEntry('m-4'),
        ],
      }),
    ).toThrow(expect.objectContaining({ rule: 'suggestion.entries.tooMany' }));
  });

  it('同じ献立を2つ含む提案を許さない', () => {
    // C-13 / B-26 規則2: 1つの提案に同じ献立を2つ以上含めない。同じものが並ぶと、
    // 選べる献立が見かけより少なくなる。
    expect(() => suggestion({ entries: [suggestionEntry('m-1'), suggestionEntry('m-1')] })).toThrow(
      MealRuleViolation,
    );
  });

  it('離れた位置にある同じ献立も重複として断る', () => {
    // C-13 / B-26 規則2: 隣どうしだけを比べる実装はこの入力を黙って通す。
    // 重複は列の全体で見るものである。
    expect(() =>
      suggestion({
        entries: [suggestionEntry('m-1'), suggestionEntry('m-2'), suggestionEntry('m-1')],
      }),
    ).toThrow(MealRuleViolation);
  });

  it('重複の規則違反は識別子から判別できる', () => {
    // ADR-025 / B-26 8章.
    expect(() => suggestion({ entries: [suggestionEntry('m-1'), suggestionEntry('m-1')] })).toThrow(
      expect.objectContaining({ rule: 'suggestion.entries.duplicateMeal' }),
    );
  });

  it('全件が再利用の由来の提案を作れる', () => {
    // C-14 / C-15 / FR-35: 再利用だけで組めた提案も提案として成立する。生成を
    // 1件も挟まないことが、LLM を呼ばない経路そのものである。
    const created = suggestion({
      entries: [suggestionEntry('m-1', 'reused'), suggestionEntry('m-2', 'reused')],
    });

    expect(created.entries.map((entry) => entry.origin)).toEqual(['reused', 'reused']);
  });

  it('生成と再利用が混ざる提案を許さない', () => {
    // C-15 / ADR-022 / B-26 規則3: 1つの提案は「作れる既存の献立」か「新しく生成した
    // もの」のどちらかであり、足りない分を生成で埋めない。
    expect(() =>
      suggestion({
        entries: [suggestionEntry('m-1', 'generated'), suggestionEntry('m-2', 'reused')],
      }),
    ).toThrow(MealRuleViolation);
  });

  it('由来が混ざる規則違反は識別子から判別できる', () => {
    // ADR-025 / B-26 8章.
    expect(() =>
      suggestion({
        entries: [suggestionEntry('m-1', 'generated'), suggestionEntry('m-2', 'reused')],
      }),
    ).toThrow(expect.objectContaining({ rule: 'suggestion.entries.mixedOrigin' }));
  });

  it('別の提案が同じ献立を含んでいても、生成の由来の提案を作れる', () => {
    // C-4c / C-13: 重複を断るのは1つの提案の中だけである。同じ献立が以前の提案に
    // 再利用として載っていても、次の提案には生成の由来で載りうる。
    suggestion({ entries: [suggestionEntry('m-1', 'reused')] });

    const generatedSuggestion = suggestion({ entries: [suggestionEntry('m-1', 'generated')] });

    expect(generatedSuggestion.entries[0]?.origin).toBe('generated');
  });

  it('提案の1件は渡した順のまま並び、並べ替えない', () => {
    // B-26 規則4 / ADR-036 決定4: 並べるのは呼ぶ側の仕事である（C-12 の順）。
    // ここで並べ替えると、呼ぶ側が決めた順が黙って失われる。
    const created = suggestion({
      entries: [suggestionEntry('m-3'), suggestionEntry('m-1'), suggestionEntry('m-2')],
    });

    expect(mealIdsOf(created)).toEqual(['m-3', 'm-1', 'm-2']);
  });

  it('作ったあとに世帯を差し替えられない', () => {
    // C-9 / B-26 規則6: 世帯を変える経路を置かない。差し替えられると、
    // 他の世帯の提案として読める値を作れてしまう。
    const created = suggestion();

    expect(() => {
      (created as { householdId: string }).householdId = '99999999-9999-4999-8999-999999999999';
    }).toThrow(TypeError);
  });

  it('抱えている提案の1件の列に後から足せない', () => {
    // domain-model 4章: 生成後は完全に不変（追記も削除もしない）。列を凍結しないと、
    // 集約を通さずに4件目を足せてしまう。
    const created = suggestion();

    expect(() => (created.entries as SuggestionEntry[]).push(suggestionEntry('m-2'))).toThrow(
      TypeError,
    );
  });

  it('呼ぶ側が渡した列を後から書き換えても、提案の1件の列は変わらない', () => {
    // domain-model 4章 / 先行 createMeal: 受け取った配列は複製してから凍結する。
    // 複製しないと、呼ぶ側が持ち続けている参照から不変条件を通らない変更が入る。
    const passedEntries = [suggestionEntry('m-1')];
    const created = suggestion({ entries: passedEntries });

    passedEntries.push(suggestionEntry('m-2'));

    expect(created.entries.length).toBe(1);
  });
});
