/**
 * 世帯の識別子。冷蔵庫を共有する単位であり、全データの所有者にあたる。
 *
 * ここに置いているのは、**4つの集約すべてが持つ唯一の型**だからである
 * （ドメインモデル 2章の共有カーネル / C-9）。コンテキストをまたぐ他の型を
 * ここに足さないこと。太らせるとコンテキストを分けた意味がなくなる。
 */
export type HouseholdId = string & { readonly __brand: 'HouseholdId' };

/**
 * 文字列を世帯の識別子として扱う。
 *
 * 書式は検査しない。**識別子を発行するのはこのドメインではなく認証基盤である**
 * （ADR-020）ため、ここで形を決めると、決めた側とずれたときに登録が止まる。
 */
export function householdIdOf(raw: string): HouseholdId {
  return raw as HouseholdId;
}
