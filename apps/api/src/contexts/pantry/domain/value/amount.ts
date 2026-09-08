/**
 * 分量。「200g」「1本」「少々」。
 *
 * **自由文字列であり、数値と単位に分解しない**（ADR-010）。分量を使うのは LLM への
 * 入力と画面表示だけで、数量の演算をする要件が存在しない。構造化すると入力欄が増え、
 * 登録の手間という最大の離脱要因を悪化させる。
 */
export type Amount = string & { readonly __brand: 'Amount' };

/**
 * 文字列を分量として扱う。前後の空白は落とす。
 *
 * **空文字と空白だけの入力は「分量なし」として `null` を返す。** 分量は任意入力で
 * あり、空の分量を作れてしまうと「分量が無い」の判定が2通りになる。
 */
export function amountOf(raw: string): Amount | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : (trimmed as Amount);
}
