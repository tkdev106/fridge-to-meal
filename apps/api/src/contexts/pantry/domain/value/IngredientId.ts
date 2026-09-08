/**
 * 食材カタログの項目を指す識別子。
 *
 * **カタログコンテキストの型を import しない。** コンテキストをまたぐ参照は識別子で
 * 行い（ADR-008）、相手の domain を直接 import しないと決めている（ADR-004 / ADR-013）。
 * そのため在庫側は「カタログのどれかを指す文字列」としてだけ知っている。
 * カタログ側の型との突き合わせが要るときは、ユースケース層で行う。
 */
export type IngredientId = string & { readonly __brand: 'IngredientId' };

export function ingredientIdOf(raw: string): IngredientId {
  return raw as IngredientId;
}
