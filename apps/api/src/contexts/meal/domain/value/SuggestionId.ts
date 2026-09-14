/** 提案の識別子。 */
export type SuggestionId = string & { readonly __brand: 'SuggestionId' };

/**
 * 文字列を提案の識別子として扱う。
 *
 * 書式は検査しない — 値の形は発行する側が決める（B-26 規則14 / ADR-026。先行は `mealIdOf`）。
 */
export function suggestionIdOf(raw: string): SuggestionId {
  return raw as SuggestionId;
}
