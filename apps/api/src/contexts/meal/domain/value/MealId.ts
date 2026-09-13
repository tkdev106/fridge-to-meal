/** 献立の識別子。 */
export type MealId = string & { readonly __brand: 'MealId' };

/**
 * 文字列を献立の識別子として扱う。
 *
 * 書式は検査しない — 値の形は発行する側が決める（ADR-026。先行は `stockItemIdOf`）。
 */
export function mealIdOf(raw: string): MealId {
  return raw as MealId;
}
