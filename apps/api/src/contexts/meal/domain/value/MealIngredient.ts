import { MealRuleViolation } from '../error/MealRuleViolation.js';

/** 材料の種別（C-16）。主材料だけが充足の突き合わせの対象になる（ADR-023）。 */
export type MealIngredientKind = 'main' | 'seasoning';

/**
 * 材料。献立が必要とする食材と、その種別。
 *
 * 在庫品への参照は持たず、名称を文字列として複製する（C-5）。
 */
export type MealIngredient = {
  /** 生成の経路を1つに絞るための印。素のオブジェクトリテラルを MealIngredient として扱えなくする。 */
  readonly __brand: 'MealIngredient';
  readonly name: string;
  readonly kind: MealIngredientKind;
};

/**
 * 材料を作る（B-13 規則9）。名称の前後空白を落とし、落とした結果が空なら通さない。
 *
 * @throws {MealRuleViolation} 名称が空、または空白だけのとき
 */
export function createMealIngredient(props: {
  name: string;
  kind: MealIngredientKind;
}): MealIngredient {
  // 落とすのは前後の空白だけ。在庫品の名称も createStockItem が同じ trim を
  // 通しているため、片側だけ別の正規化にすると充足の一致が静かにずれる（C-6）。
  const name = props.name.trim();
  if (name === '') {
    // 空の名称は在庫に対して存在しないのと同じになり、永久に不足材料になる。
    throw new MealRuleViolation('ingredient.name.empty', '材料の名称が空です');
  }

  // 凍結する。献立は生成後に編集できない（C-3）ため、可変にすると不変条件を
  // 通らない書き換えが可能になる。
  return Object.freeze({
    __brand: 'MealIngredient' as const,
    name,
    kind: props.kind,
  });
}
