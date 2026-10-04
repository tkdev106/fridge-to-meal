import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';

/**
 * 世帯を抜ける出口（B-75 設計書 5章 / FR-46 / ADR-087 決定6）。
 *
 * 誰が抜けるかはトランザクションのクレームが決める（設計書 規則11）。引数の世帯は
 * 口の形を C-9 に揃えるためにある。
 */
export interface HouseholdLeaver {
  /** 抜けたら true、自分しか居なくて何もしなかったら false */
  leave(householdId: HouseholdId): Promise<boolean>;
}
