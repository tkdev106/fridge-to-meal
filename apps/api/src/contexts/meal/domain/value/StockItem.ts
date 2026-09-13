import { MealRuleViolation } from '../error/MealRuleViolation.js';
import type { ExpiryDate } from './ExpiryDate.js';

/**
 * 在庫品。献立側は**名称と期限だけ**を持つ（ADR-036 決定3）。
 *
 * 指しているものは在庫コンテキストの在庫品と同じ1件だが、集約ルートは向こうにあり、
 * こちらは**再利用の規則が見る2つだけ**を持つ射影である。分量も識別子も世帯も持たない
 * のは、規則が見ないものを引数に入れないためである（ADR-033 決定3）。
 *
 * この形では在庫スナップショット `PantrySnapshot`（C-7）は組めない。一致比較には
 * 分量が要るためで、足りないのは意図した結果である（ADR-036 結果9）。
 */
export type StockItem = {
  /** 生成の経路を1つに絞るための印。素のオブジェクトリテラルを StockItem として扱えなくする。 */
  readonly __brand: 'StockItem';
  readonly name: string;
  readonly expiryDate: ExpiryDate | null;
};

/**
 * 在庫品を作る。名称の前後空白を落とし、落とした結果が空なら通さない。
 *
 * @throws {MealRuleViolation} 名称が空、または空白だけのとき
 */
export function createStockItem(props: {
  name: string;
  /** 必須引数。省略できると「期限なし」の表し方が2通りになる（先行 createMealIngredient の分量）。 */
  expiryDate: ExpiryDate | null;
}): StockItem {
  // 落とすのは前後の空白だけ。突き合わせは名称の完全一致（C-6）であり、材料側の
  // createMealIngredient も同じ trim を通しているため、片側だけ別の正規化にすると
  // 一致が静かにずれる。
  const name = props.name.trim();
  if (name === '') {
    // 空の名称は献立に対して存在しないのと同じになり、どの材料も賄えない。
    throw new MealRuleViolation('stockItem.name.empty', '在庫品の名称が空です');
  }

  // 凍結する。可変にすると、規則を通らない名称を後から入れられる（先行 createMealIngredient）。
  return Object.freeze({
    __brand: 'StockItem' as const,
    name,
    expiryDate: props.expiryDate,
  });
}
