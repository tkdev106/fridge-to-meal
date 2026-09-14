import { MealRuleViolation } from '../error/MealRuleViolation.js';
import type { Amount } from './Amount.js';
import type { ExpiryDate } from './ExpiryDate.js';

/**
 * 在庫品。献立側は**名称・分量・期限の3つ**を持つ（ADR-036 決定3 + ADR-037 決定1）。
 *
 * 指しているものは在庫コンテキストの在庫品と同じ1件だが、集約ルートは向こうにあり、
 * こちらは**献立側の規則が見るものの総和だけ**を持つ射影である。C-6 と C-12 が名称と
 * 期限を見、C-7 が加えて分量を見る。識別子も世帯もカタログ参照も持たないのは、
 * どの規則も見ないものを持ち込まないためである（ADR-033 決定3 / ADR-037 理由(2)）。
 *
 * この3項目で在庫スナップショット `PantrySnapshot`（C-7）が組める。分量は**運ぶだけの
 * 項目**であり、充足にも並び順にも効かない — 判定が1つ増えたのではない（ADR-037 結果7）。
 */
export type StockItem = {
  /** 生成の経路を1つに絞るための印。素のオブジェクトリテラルを StockItem として扱えなくする。 */
  readonly __brand: 'StockItem';
  readonly name: string;
  /** C-7 の一致比較が見る3項目のうちの1つ（ADR-037 決定1）。 */
  readonly amount: Amount | null;
  readonly expiryDate: ExpiryDate | null;
};

/**
 * 在庫品を作る。名称の前後空白を落とし、落とした結果が空なら通さない。
 *
 * @throws {MealRuleViolation} 名称が空、または空白だけのとき
 */
export function createStockItem(props: {
  name: string;
  /** 必須引数。省略できると「分量なし」の表し方が2通りになる（先行 createMealIngredient の分量）。 */
  amount: Amount | null;
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
  // 分量と期限は amountOf / expiryDateOf を通った値をそのまま抱える。ここで再び正規化すると
  // 正規化の規則が2か所に散り、片方だけ変わったときに一致が静かにずれる（ADR-037 理由(3)）。
  return Object.freeze({
    __brand: 'StockItem' as const,
    name,
    amount: props.amount,
    expiryDate: props.expiryDate,
  });
}
