import { describe, expect, it } from 'vitest';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';

/** 名称と種別だけ変えて材料を作る。テストの本題以外を書かないためのもの。 */
function 材料(overrides: Partial<Parameters<typeof createMealIngredient>[0]> = {}) {
  return createMealIngredient({
    name: 'にんじん',
    kind: 'main',
    ...overrides,
  });
}

describe('材料 MealIngredient', () => {
  it('名称と種別を持つ', () => {
    const ingredient = 材料({ name: 'にんじん', kind: 'main' });

    expect(ingredient.name).toBe('にんじん');
    expect(ingredient.kind).toBe('main');
  });

  it('調味料の種別の材料も作れる', () => {
    // C-16 / ADR-023: 種別は主材料と調味料の2つ。調味料は充足の突き合わせに載らない。
    expect(材料({ name: 'しょうゆ', kind: 'seasoning' }).kind).toBe('seasoning');
  });

  it('名称の前後の空白は落とす', () => {
    // B-13 規則9・規則2 / C-6: 充足判定は名称の完全一致。在庫品の名称は登録時に
    // 前後空白を落としてあるため、材料側で落とさないと一致が静かにずれる。
    expect(材料({ name: '  にんじん  ' }).name).toBe('にんじん');
  });

  it('空の名称を許さない', () => {
    // B-13 規則9 / 7章: 空の名称は在庫に対して存在しないのと同じになり、永久に不足材料になる。
    expect(() => 材料({ name: '' })).toThrow(MealRuleViolation);
  });

  it('空白だけの名称を許さない', () => {
    // B-13 規則9: 前後空白を落とした結果が空のものも通さない。
    expect(() => 材料({ name: '   ' })).toThrow(MealRuleViolation);
  });

  it('空の名称の規則違反は識別子から判別できる', () => {
    // B-13 7章 / ADR-025: 反した規則は識別子で持つ。文言ではなく rule で分岐できること。
    expect(() => 材料({ name: '' })).toThrow(
      expect.objectContaining({ rule: 'ingredient.name.empty' }),
    );
  });

  it('名称の途中の空白は落とさない', () => {
    // B-13 規則2 / C-6: 落とすのは前後だけ。途中の空白を詰めると別の名称になる。
    expect(材料({ name: '豚 こま肉' }).name).toBe('豚 こま肉');
  });

  it('大文字小文字や全角半角を変換せず、書かれたとおりに保持する', () => {
    // B-13 規則2 / C-6: 正規化は前後空白を落とすことだけ。表記ゆれは吸収しない（既知の割り切り）。
    expect(材料({ name: 'Ｂａｃｏｎ' }).name).toBe('Ｂａｃｏｎ');
    expect(材料({ name: 'bacon' }).name).toBe('bacon');
    expect(材料({ name: 'Ｂａｃｏｎ' }).name).not.toBe(材料({ name: 'bacon' }).name);
  });

  it('作ったあとに書き換えられない', () => {
    // B-13 規則10 / C-3: 献立は生成後に編集できない。可変にすると不変条件を通らない
    // 書き換えが可能になる。
    const ingredient = 材料();

    expect(() => {
      (ingredient as { name: string }).name = 'たまねぎ';
    }).toThrow();
  });

  it('全角の空白も前後なら落とす', () => {
    // backlog B-13「両側の前後空白を落とす」/ C-6: 在庫品側は createStockItem が
    // 落としている。片側だけ ASCII の空白しか落とさないと充足の一致がずれる。
    expect(材料({ name: '　にんじん　' }).name).toBe('にんじん');
  });
});
