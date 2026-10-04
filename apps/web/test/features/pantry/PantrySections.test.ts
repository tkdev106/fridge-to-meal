import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import type { ExpirySection, PantrySection } from '../../../src/features/pantry/PantrySections.js';
import { expirySectionOf, pantrySectionsOf } from '../../../src/features/pantry/PantrySections.js';

/** 本題でないほうを固定する。基準日を動かすテストだけが第2引数を渡す。 */
const DEFAULT_AS_OF = '2026-09-11';

/** 本題でない識別子の採番。識別子で照合するテストは自分で literal を渡す。 */
let sequence = 0;
function nextId() {
  sequence += 1;
  return `id-${sequence}`;
}

/** テストの本題でない項目を隠す（`docs/testing.md` 6章）。本題だけが引数に現れる。 */
function stockItem(
  props: { id?: string; name?: string; expiryDate?: string | null } = {},
): StockItemDto {
  return {
    id: props.id ?? nextId(),
    name: props.name ?? 'にんじん',
    ingredientId: null,
    amount: null,
    expiryDate: props.expiryDate === undefined ? null : props.expiryDate,
    useForMeals: true,
  };
}

function sectionsOf(stockItems: readonly StockItemDto[], asOf: string = DEFAULT_AS_OF) {
  return pantrySectionsOf(stockItems, asOf);
}

/** 返った帯の並び（規則6）。 */
function sectionNames(sections: readonly PantrySection[]) {
  return sections.map((section) => section.section);
}

/** ある帯に入っている在庫品の識別子を、返った順に並べたもの。帯が無ければ空。 */
function idsOf(sections: readonly PantrySection[], expirySection: ExpirySection) {
  const found = sections.find((section) => section.section === expirySection);

  return found === undefined ? [] : found.stockItems.map((row) => row.stockItem.id);
}

/** 返ったすべての行の残日数を、返った順に並べたもの（FR-11）。 */
function remainingDaysList(sections: readonly PantrySection[]) {
  return sections.flatMap((section) => section.stockItems.map((row) => row.remainingDays));
}

describe('期限の帯 expirySectionOf', () => {
  it('期限を過ぎているものは危険の帯に入れる', () => {
    // FR-12（超過=危険）/ B-11 設計 規則5。
    expect(expirySectionOf(-1)).toBe('urgent');
  });

  it('期限が当日のものは危険の帯に入れる', () => {
    // FR-12（当日=危険）/ B-11 設計 規則5。
    expect(expirySectionOf(0)).toBe('urgent');
  });

  it('残り1日のものは警告の帯に入れる', () => {
    // FR-12（3日以内=警告）/ B-11 設計 規則5。
    expect(expirySectionOf(1)).toBe('soon');
  });

  it('残り3日のものまでは警告の帯に入れる', () => {
    // FR-12 / B-11 設計 規則5: 境目は3日。
    expect(expirySectionOf(3)).toBe('soon');
  });

  it('残り4日のものは警告の帯に入れない', () => {
    // FR-12 / B-11 設計 規則5。
    expect(expirySectionOf(4)).toBe('rest');
  });

  it('残日数が無いものは警告の対象にしない', () => {
    // FR-13 / B-11 設計 規則3・5: 期限未設定は警告の対象外。
    expect(expirySectionOf(null)).toBe('rest');
  });
});

describe('在庫の帯分け pantrySectionsOf', () => {
  it('在庫品に基準日からの残日数を添えて返す', () => {
    // FR-11 / B-11 設計 5章: 行は在庫品と残日数の組。
    const sections = sectionsOf([stockItem({ expiryDate: '2026-09-13' })], '2026-09-11');

    expect(remainingDaysList(sections)).toEqual([2]);
  });

  it('在庫品を残日数に応じた帯に振り分ける', () => {
    // B-11 設計 規則5 / FR-12。
    const sections = sectionsOf([
      stockItem({ id: '当日', expiryDate: '2026-09-11' }),
      stockItem({ id: '二日後', expiryDate: '2026-09-13' }),
      stockItem({ id: '十日後', expiryDate: '2026-09-21' }),
    ]);

    expect({
      urgent: idsOf(sections, 'urgent'),
      soon: idsOf(sections, 'soon'),
      rest: idsOf(sections, 'rest'),
    }).toEqual({ urgent: ['当日'], soon: ['二日後'], rest: ['十日後'] });
  });

  it('帯は危険・警告・その他の順に返す', () => {
    // B-11 設計 規則6: 帯の順序は固定。渡された順に引きずられない。
    const sections = sectionsOf([
      stockItem({ expiryDate: '2026-09-21' }),
      stockItem({ expiryDate: '2026-09-13' }),
      stockItem({ expiryDate: '2026-09-11' }),
    ]);

    expect(sectionNames(sections)).toEqual(['urgent', 'soon', 'rest']);
  });

  it('該当する在庫品が無い帯は返さない', () => {
    // B-11 設計 規則6: 中身が0件の帯は出さない。
    const sections = sectionsOf([
      stockItem({ expiryDate: '2026-09-11' }),
      stockItem({ expiryDate: '2026-09-21' }),
    ]);

    expect(sectionNames(sections)).toEqual(['urgent', 'rest']);
  });

  it('在庫品が0件なら帯を1つも返さない', () => {
    // B-11 設計 規則6・11: 0件のときは登録を促す表示に倒す。
    expect(sectionsOf([])).toEqual([]);
  });

  it('帯の中は受け取った順をそのまま保ち、並べ替えない', () => {
    // FR-04 / B-11 設計 規則7: 期限の近い順は ListStockItems が既に満たしている。
    const sections = sectionsOf([
      stockItem({ id: 'その他の1件目', expiryDate: '2026-09-25' }),
      stockItem({ id: '危険の1件目', expiryDate: '2026-09-11' }),
      stockItem({ id: 'その他の2件目', expiryDate: '2026-09-20' }),
      stockItem({ id: '危険の2件目', expiryDate: '2026-09-09' }),
    ]);

    expect({
      urgent: idsOf(sections, 'urgent'),
      rest: idsOf(sections, 'rest'),
    }).toEqual({
      urgent: ['危険の1件目', '危険の2件目'],
      rest: ['その他の1件目', 'その他の2件目'],
    });
  });

  it('期限が同じ在庫品どうしも入力の順のまま返す', () => {
    // B-11 設計 規則7: 振り分けは安定である。
    const sections = sectionsOf([
      stockItem({ id: '先に渡したほう', name: 'にんじん', expiryDate: '2026-09-12' }),
      stockItem({ id: '後に渡したほう', name: 'たまねぎ', expiryDate: '2026-09-12' }),
    ]);

    expect(idsOf(sections, 'soon')).toEqual(['先に渡したほう', '後に渡したほう']);
  });

  it('同じ名称の在庫品を統合せず別々の行として返す', () => {
    // ADR-007 / B-11 設計 規則8: 同じ食材の行が並ぶことがある。
    const sections = sectionsOf([
      stockItem({ id: '当日のほう', name: 'にんじん', expiryDate: '2026-09-11' }),
      stockItem({ id: '十日後のほう', name: 'にんじん', expiryDate: '2026-09-21' }),
    ]);

    expect({
      urgent: idsOf(sections, 'urgent'),
      rest: idsOf(sections, 'rest'),
    }).toEqual({ urgent: ['当日のほう'], rest: ['十日後のほう'] });
  });

  it('期限が未設定の在庫品は残日数を無しにしてその他の帯に置く', () => {
    // FR-13 / B-11 設計 規則3・5。
    const sections = sectionsOf([stockItem({ expiryDate: null })]);

    expect([sectionNames(sections), remainingDaysList(sections)]).toEqual([['rest'], [null]]);
  });

  it('期限が壊れている在庫品でも例外を投げずその他の帯に置く', () => {
    // B-11 設計 規則4 / 7章: 1件のために一覧が出せなくなるほうが悪い。
    const sections = sectionsOf([stockItem({ expiryDate: 'abc' })]);

    expect([sectionNames(sections), remainingDaysList(sections)]).toEqual([['rest'], [null]]);
  });

  it('渡された在庫品の配列を書き換えない', () => {
    // B-11 設計 規則7 / B-05 規則7 の先例（ListStockItems）: その場で並べ替えると、
    // 一覧しただけで呼び出し側が持っている並びが変わってしまう。
    const stockItems = [
      stockItem({ id: 'その他の分', expiryDate: '2026-09-25' }),
      stockItem({ id: '危険の分', expiryDate: '2026-09-11' }),
      stockItem({ id: '警告の分', expiryDate: '2026-09-13' }),
    ];

    sectionsOf(stockItems);

    expect(stockItems.map((row) => row.id)).toEqual(['その他の分', '危険の分', '警告の分']);
  });
});
