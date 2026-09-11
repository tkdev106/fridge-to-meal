/**
 * 在庫品の列を期限の帯に振り分ける（B-11 設計 5章 / 6章 規則5〜8）。
 *
 * 返すのは数と帯の識別子だけで、日本語は持たない。見出しも残日数の書き方も画面が決める
 * （規則10 / `docs/screen-design.md` 論点3 で文言が未確定であるため）。
 */

import type { StockItemDto } from '@fridge-to-meal/contract';
import { remainingDaysOf } from './RemainingDays.js';

/** 期限の帯。危険（当日・超過）・警告（3日以内）・その他（FR-12 / 規則5）。 */
export type ExpirySection = 'urgent' | 'soon' | 'rest';

/** 一覧の1行。在庫品に残日数を添えたもの（FR-11）。 */
export type ListedStockItem = { stockItem: StockItemDto; remainingDays: number | null };

/** 帯1つと、そこに入る行（規則6）。 */
export type PantrySection = { section: ExpirySection; stockItems: readonly ListedStockItem[] };

/** 帯を出す順序。渡された在庫品の並びに引きずられない固定の順（規則6）。 */
const SECTION_ORDER = ['urgent', 'soon', 'rest'] as const;

/** 警告の帯に入れる残日数の上限。FR-12 の「3日以内」。 */
const SOON_DAYS = 3;

/** 残日数から帯を決める（規則5）。 */
export function expirySectionOf(remainingDays: number | null): ExpirySection {
  // 期限未設定は警告の対象外（FR-13 / 規則3）。壊れた期限もここに落ちてくる（規則4）。
  if (remainingDays === null) return 'rest';

  // 当日は 0、超過は負。どちらも危険として同じ帯に置く（FR-12）。
  if (remainingDays <= 0) return 'urgent';

  return remainingDays <= SOON_DAYS ? 'soon' : 'rest';
}

/** 在庫品の列を帯に振り分ける。基準日は引数で受け取る（docs/testing.md 5章）。 */
export function pantrySectionsOf(
  stockItems: readonly StockItemDto[],
  today: string,
): readonly PantrySection[] {
  const 帯ごとの行 = new Map<ExpirySection, ListedStockItem[]>(
    SECTION_ORDER.map((section) => [section, []]),
  );

  // 受け取った順に1件ずつ振り分けるだけで、並べ替えない（規則7）。期限の近い順は
  // ListStockItems が既に満たしている。同じ名称の在庫品も統合しない（規則8 / ADR-007）。
  for (const stockItem of stockItems) {
    const remainingDays = remainingDaysOf(stockItem.expiryDate, today);
    帯ごとの行.get(expirySectionOf(remainingDays))?.push({ stockItem, remainingDays });
  }

  // 中身が0件の帯は出さない（規則6）。在庫品が0件なら結果は空になり、画面は
  // 登録を促す表示に倒す（規則11）。
  return SECTION_ORDER.flatMap((section) => {
    const rows = 帯ごとの行.get(section) ?? [];

    return rows.length === 0 ? [] : [{ section, stockItems: rows }];
  });
}
