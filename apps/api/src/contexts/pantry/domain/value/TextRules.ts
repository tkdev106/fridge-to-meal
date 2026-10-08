/**
 * 在庫品の文字列（名称・分量）に共通の判定（NFR-19）。
 */

/** 字数はコードポイントで数える。UTF-16 の長さではサロゲートペアの1文字が2字になる。 */
export function lengthOf(value: string): number {
  return [...value].length;
}

const CONTROL_CHARACTER = /\p{Cc}/u;

/** Unicode の一般カテゴリ Cc（改行・タブ・CR を含む）を1つでも含むか。全角空白は Cc ではない。 */
export function containsControlCharacter(value: string): boolean {
  return CONTROL_CHARACTER.test(value);
}
