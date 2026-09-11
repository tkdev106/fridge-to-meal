import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import type { ExpirySection, PantrySection } from '../../../src/features/pantry/PantrySections.js';
import { expirySectionOf, pantrySectionsOf } from '../../../src/features/pantry/PantrySections.js';

/** 本題でないほうを固定する。基準日を動かすテストだけが第2引数を渡す。 */
const 既定の基準日 = '2026-09-11';

/** 本題でない識別子の採番。識別子で照合するテストは自分で literal を渡す。 */
let 連番 = 0;
function 次の識別子() {
  連番 += 1;
  return `id-${連番}`;
}

/** テストの本題でない項目を隠す（`docs/testing.md` 6章）。本題だけが引数に現れる。 */
function 在庫品(
  props: { id?: string; name?: string; expiryDate?: string | null } = {},
): StockItemDto {
  return {
    id: props.id ?? 次の識別子(),
    name: props.name ?? 'にんじん',
    ingredientId: null,
    amount: null,
    expiryDate: props.expiryDate === undefined ? null : props.expiryDate,
  };
}

function 帯に分ける(在庫品の列: readonly StockItemDto[], 基準日: string = 既定の基準日) {
  return pantrySectionsOf(在庫品の列, 基準日);
}

/** 返った帯の並び（規則6）。 */
function 帯の列(sections: readonly PantrySection[]) {
  return sections.map((section) => section.section);
}

/** ある帯に入っている在庫品の識別子を、返った順に並べたもの。帯が無ければ空。 */
function 識別子の列(sections: readonly PantrySection[], 帯: ExpirySection) {
  const 該当 = sections.find((section) => section.section === 帯);

  return 該当 === undefined ? [] : 該当.stockItems.map((row) => row.stockItem.id);
}

/** 返ったすべての行の残日数を、返った順に並べたもの（FR-11）。 */
function 残日数の列(sections: readonly PantrySection[]) {
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
    const sections = 帯に分ける([在庫品({ expiryDate: '2026-09-13' })], '2026-09-11');

    expect(残日数の列(sections)).toEqual([2]);
  });

  it('在庫品を残日数に応じた帯に振り分ける', () => {
    // B-11 設計 規則5 / FR-12。
    const sections = 帯に分ける([
      在庫品({ id: '当日', expiryDate: '2026-09-11' }),
      在庫品({ id: '二日後', expiryDate: '2026-09-13' }),
      在庫品({ id: '十日後', expiryDate: '2026-09-21' }),
    ]);

    expect({
      urgent: 識別子の列(sections, 'urgent'),
      soon: 識別子の列(sections, 'soon'),
      rest: 識別子の列(sections, 'rest'),
    }).toEqual({ urgent: ['当日'], soon: ['二日後'], rest: ['十日後'] });
  });

  it('帯は危険・警告・その他の順に返す', () => {
    // B-11 設計 規則6: 帯の順序は固定。渡された順に引きずられない。
    const sections = 帯に分ける([
      在庫品({ expiryDate: '2026-09-21' }),
      在庫品({ expiryDate: '2026-09-13' }),
      在庫品({ expiryDate: '2026-09-11' }),
    ]);

    expect(帯の列(sections)).toEqual(['urgent', 'soon', 'rest']);
  });

  it('該当する在庫品が無い帯は返さない', () => {
    // B-11 設計 規則6: 中身が0件の帯は出さない。
    const sections = 帯に分ける([
      在庫品({ expiryDate: '2026-09-11' }),
      在庫品({ expiryDate: '2026-09-21' }),
    ]);

    expect(帯の列(sections)).toEqual(['urgent', 'rest']);
  });

  it('在庫品が0件なら帯を1つも返さない', () => {
    // B-11 設計 規則6・11: 0件のときは登録を促す表示に倒す。
    expect(帯に分ける([])).toEqual([]);
  });

  it('帯の中は受け取った順をそのまま保ち、並べ替えない', () => {
    // FR-04 / B-11 設計 規則7: 期限の近い順は ListStockItems が既に満たしている。
    const sections = 帯に分ける([
      在庫品({ id: 'その他の1件目', expiryDate: '2026-09-25' }),
      在庫品({ id: '危険の1件目', expiryDate: '2026-09-11' }),
      在庫品({ id: 'その他の2件目', expiryDate: '2026-09-20' }),
      在庫品({ id: '危険の2件目', expiryDate: '2026-09-09' }),
    ]);

    expect({
      urgent: 識別子の列(sections, 'urgent'),
      rest: 識別子の列(sections, 'rest'),
    }).toEqual({
      urgent: ['危険の1件目', '危険の2件目'],
      rest: ['その他の1件目', 'その他の2件目'],
    });
  });

  it('期限が同じ在庫品どうしも入力の順のまま返す', () => {
    // B-11 設計 規則7: 振り分けは安定である。
    const sections = 帯に分ける([
      在庫品({ id: '先に渡したほう', name: 'にんじん', expiryDate: '2026-09-12' }),
      在庫品({ id: '後に渡したほう', name: 'たまねぎ', expiryDate: '2026-09-12' }),
    ]);

    expect(識別子の列(sections, 'soon')).toEqual(['先に渡したほう', '後に渡したほう']);
  });

  it('同じ名称の在庫品を統合せず別々の行として返す', () => {
    // ADR-007 / B-11 設計 規則8: 同じ食材の行が並ぶことがある。
    const sections = 帯に分ける([
      在庫品({ id: '当日のほう', name: 'にんじん', expiryDate: '2026-09-11' }),
      在庫品({ id: '十日後のほう', name: 'にんじん', expiryDate: '2026-09-21' }),
    ]);

    expect({
      urgent: 識別子の列(sections, 'urgent'),
      rest: 識別子の列(sections, 'rest'),
    }).toEqual({ urgent: ['当日のほう'], rest: ['十日後のほう'] });
  });

  it('期限が未設定の在庫品は残日数を無しにしてその他の帯に置く', () => {
    // FR-13 / B-11 設計 規則3・5。
    const sections = 帯に分ける([在庫品({ expiryDate: null })]);

    expect([帯の列(sections), 残日数の列(sections)]).toEqual([['rest'], [null]]);
  });

  it('期限が壊れている在庫品でも例外を投げずその他の帯に置く', () => {
    // B-11 設計 規則4 / 7章: 1件のために一覧が出せなくなるほうが悪い。
    const sections = 帯に分ける([在庫品({ expiryDate: 'abc' })]);

    expect([帯の列(sections), 残日数の列(sections)]).toEqual([['rest'], [null]]);
  });

  it('渡された在庫品の配列を書き換えない', () => {
    // B-11 設計 規則7 / B-05 規則7 の先例（ListStockItems）: その場で並べ替えると、
    // 一覧しただけで呼び出し側が持っている並びが変わってしまう。
    const 在庫品の列 = [
      在庫品({ id: 'その他の分', expiryDate: '2026-09-25' }),
      在庫品({ id: '危険の分', expiryDate: '2026-09-11' }),
      在庫品({ id: '警告の分', expiryDate: '2026-09-13' }),
    ];

    帯に分ける(在庫品の列);

    expect(在庫品の列.map((row) => row.id)).toEqual(['その他の分', '危険の分', '警告の分']);
  });
});
