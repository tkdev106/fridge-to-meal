import type { DateTime } from './DateTime.js';

/**
 * 調理記録。献立を実際に作ったという記録（domain-model 3章）。
 *
 * 追加のみで、取り消さない（C-3）。
 */
export type CookingRecord = {
  /** 生成の経路を1つに絞るための印。素のオブジェクトリテラルを CookingRecord として扱えなくする。 */
  readonly __brand: 'CookingRecord';
  readonly cookedAt: DateTime;
};

/** 調理記録を作る。 */
export function createCookingRecord(props: { cookedAt: DateTime }): CookingRecord {
  // 凍結する。記録された事実を後から書き換えられると、追加のみという決まりが
  // 実質的に失われる（C-3）。
  return Object.freeze({
    __brand: 'CookingRecord' as const,
    cookedAt: props.cookedAt,
  });
}
