/**
 * 分量。「200g」「1本」「少々」。
 *
 * **自由文字列であり、数値と単位に分解しない**（ADR-010）。在庫の `Amount` と同じ規則を
 * 献立コンテキストに起こしたものである（ADR-034）。
 */
export type Amount = string & { readonly __brand: 'Amount' };

/**
 * 文字列を分量として扱う。前後の空白は落とす。
 *
 * `null`・空文字・空白だけの入力は、すべて「分量なし」として `null` を返す（ADR-010）。
 */
export function amountOf(raw: string | null): Amount | null {
  if (raw === null) return null;

  // 分量なしを Amount として作れると「分量が無い」の判定が2通りになる。
  // 正規化の規則の出所は ADR-010 であり、在庫側の amountOf と同じにそろえる（ADR-034）。
  const trimmed = raw.trim();
  return trimmed === '' ? null : (trimmed as Amount);
}
