import { describe, expect, it } from 'vitest';
import { createGeneratedMeal } from '../../../../src/contexts/meal/domain/value/GeneratedMeal.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import type { CookingStep } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import type { MealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';

function 主材料(name: string, amount: string | null = null) {
  return createMealIngredient({ name, kind: 'main', amount: amountOf(amount) });
}

function 調味料(name: string) {
  // C-16 / ADR-023: 種別は主材料と調味料の2つ。調味料は充足の突き合わせに載らない。
  return createMealIngredient({ name, kind: 'seasoning', amount: null });
}

/**
 * 本題でない値を隠して生成結果を作る。既定は主材料1件・手順1件。
 *
 * **ヘルパーの名前も英語のままにする** — `GeneratedMeal` に日本語の呼び名を新しく作らない
 * （B-15 3章。同義語を1語増やすことになる）。
 */
function generatedMeal(overrides: Partial<Parameters<typeof createGeneratedMeal>[0]> = {}) {
  return createGeneratedMeal({
    title: '肉じゃが',
    ingredients: [主材料('牛肉')],
    steps: [cookingStepOf('煮る')],
    ...overrides,
  });
}

describe('GeneratedMeal', () => {
  it('名称・材料・手順を持つ', () => {
    // B-15 5章 / prompt-design 2.2: 持つのはこの3つだけ。
    const generated = generatedMeal({
      title: '肉じゃが',
      ingredients: [主材料('牛肉')],
      steps: [cookingStepOf('煮る')],
    });

    expect(generated.title).toBe('肉じゃが');
    expect(generated.ingredients.length).toBe(1);
    expect(generated.steps.length).toBe(1);
  });

  it('識別子・世帯・生成日時・由来の項目を持たない', () => {
    // B-15 規則3 / C-1 / ADR-035: 永続化は呼ぶ側の仕事であり、由来は
    // SuggestionEntry.origin が表す。ここで持つと Meal と見分けがつかなくなる。
    const 材料 = 主材料('牛肉');
    const 手順 = cookingStepOf('煮る');

    expect(generatedMeal({ title: '肉じゃが', ingredients: [材料], steps: [手順] })).toEqual({
      __brand: 'GeneratedMeal',
      title: '肉じゃが',
      ingredients: [材料],
      steps: [手順],
    });
  });

  it('名称の前後の空白は落とす', () => {
    // B-15 規則11 / C-6: 先行の createMeal と同じ正規化。片側だけ別の正規化にすると、
    // 名称の完全一致がずれる。
    expect(generatedMeal({ title: '  肉じゃが  ' }).title).toBe('肉じゃが');
  });

  it('名称の途中の空白は落とさない', () => {
    // B-15 規則11 / C-6: 落とすのは前後だけ。途中を詰めると別の名称になる。
    expect(generatedMeal({ title: '鶏むね肉 の 照り焼き' }).title).toBe('鶏むね肉 の 照り焼き');
  });

  it('空の名称を許さない', () => {
    // B-15 7章 / domain-model 4章: 名称の無いものは画面にも一覧にも出せない。
    expect(() => generatedMeal({ title: '' })).toThrow(MealRuleViolation);
  });

  it('空白だけの名称を許さない', () => {
    // B-15 規則11: 前後の空白を落とした結果が空なら通さない。
    expect(() => generatedMeal({ title: '   ' })).toThrow(MealRuleViolation);
  });

  it('空の名称の規則違反は識別子から判別できる', () => {
    // B-15 7章 / 前提4 / ADR-025: 反した規則は識別子で持つ。文言ではなく rule で分岐できること。
    expect(() => generatedMeal({ title: '' })).toThrow(
      expect.objectContaining({ rule: 'generatedMeal.title.empty' }),
    );
  });

  it('材料が1件も無いものを許さない', () => {
    // B-15 規則12 / domain-model 4章: 材料が無いと充足を算出できない。
    expect(() => generatedMeal({ ingredients: [] })).toThrow(MealRuleViolation);
  });

  it('材料が空の規則違反は識別子から判別できる', () => {
    // B-15 7章 / 前提4 / ADR-025.
    expect(() => generatedMeal({ ingredients: [] })).toThrow(
      expect.objectContaining({ rule: 'generatedMeal.ingredients.empty' }),
    );
  });

  it('主材料が1件も無いものを許さない', () => {
    // B-15 規則12 / C-16 / ADR-023: 調味料だけでは充足の突き合わせに載る材料が
    // 1件も無く、在庫に関わらず不足0件（作れる）と判定されてしまう。
    expect(() => generatedMeal({ ingredients: [調味料('しょうゆ'), 調味料('みりん')] })).toThrow(
      MealRuleViolation,
    );
  });

  it('主材料が無い規則違反は、材料が空の違反と識別子で見分けられる', () => {
    // B-15 7章 / 前提4 / ADR-025: 直し方が違う2つの違反を、呼ぶ側が rule で見分けられること。
    expect(() => generatedMeal({ ingredients: [調味料('しょうゆ'), 調味料('みりん')] })).toThrow(
      expect.objectContaining({ rule: 'generatedMeal.ingredients.noMain' }),
    );
  });

  it('主材料が1件あれば、残りが調味料でも作れる', () => {
    // B-15 規則12 / C-16: 境界は主材料1件。
    const generated = generatedMeal({
      ingredients: [主材料('牛肉'), 調味料('しょうゆ'), 調味料('みりん')],
    });

    expect(generated.ingredients.length).toBe(3);
  });

  it('手順が1件も無いものを許さない', () => {
    // B-15 規則12 / domain-model 4章: 手順が無いものは作れる形になっていない。
    expect(() => generatedMeal({ steps: [] })).toThrow(MealRuleViolation);
  });

  it('手順が空の規則違反は識別子から判別できる', () => {
    // B-15 7章 / 前提4 / ADR-025.
    expect(() => generatedMeal({ steps: [] })).toThrow(
      expect.objectContaining({ rule: 'generatedMeal.steps.empty' }),
    );
  });

  it('手順は渡した順に並び、並べ替えも番号の付与もしない', () => {
    // B-15 規則13 / prompt-design 2.2: 順序は配列の添字が持つ。番号の項目を置かない。
    const generated = generatedMeal({
      steps: [cookingStepOf('切る'), cookingStepOf('炒める'), cookingStepOf('煮る')],
    });

    expect(generated.steps).toEqual(['切る', '炒める', '煮る']);
  });

  it('材料は渡した順に並び、主材料を先頭へ寄せない', () => {
    // B-15 規則13: 並べ替えない。並べ替えると、生成側が書いた材料の並びが失われる。
    const generated = generatedMeal({ ingredients: [調味料('しょうゆ'), 主材料('牛肉')] });

    expect(generated.ingredients.map((ingredient) => ingredient.name)).toEqual([
      'しょうゆ',
      '牛肉',
    ]);
  });

  it('作ったあとに書き換えられない', () => {
    // B-15 規則13 / C-3: 生成後に編集できない。可変にすると不変条件を通らない
    // 書き換えが可能になる。
    const generated = generatedMeal();

    expect(() => {
      (generated as { title: string }).title = 'カレー';
    }).toThrow(TypeError);
  });

  it('持っている材料と手順の列に後から足せない', () => {
    // B-15 規則13 / C-3: 列そのものも凍結する。凍結しないと、生成関数を通さずに
    // 材料や手順を足せてしまう。
    const generated = generatedMeal();

    expect(() => (generated.ingredients as MealIngredient[]).push(主材料('じゃがいも'))).toThrow(
      TypeError,
    );
    expect(() => (generated.steps as CookingStep[]).push(cookingStepOf('盛る'))).toThrow(TypeError);
  });

  it('呼ぶ側が渡した材料と手順の配列を後から書き換えても、値の材料と手順は変わらない', () => {
    // B-15 規則13: 受け取った列は複製してから凍結する。複製しないと、呼ぶ側が
    // 持ち続けている参照から不変条件を通らない変更が入る。
    const 渡した材料 = [主材料('牛肉')];
    const 渡した手順 = [cookingStepOf('煮る')];
    const generated = generatedMeal({ ingredients: 渡した材料, steps: 渡した手順 });

    渡した材料.push(主材料('じゃがいも'));
    渡した手順.push(cookingStepOf('盛る'));

    expect(generated.ingredients.length).toBe(1);
    expect(generated.steps.length).toBe(1);
  });

  it('腐敗防止層が見る長さと件数の上限をドメインでは見ない', () => {
    // B-15 規則14 / prompt-design 6.2: 名称40字・材料12件・手順8件の上限は
    // 腐敗防止層の検証の規則であって、domain-model 4章の不変条件ではない。
    const generated = generatedMeal({
      title: '肉じゃが'.repeat(11),
      ingredients: Array.from({ length: 13 }, (_, 添字) => 主材料(`にんじん${添字 + 1}`)),
      steps: Array.from({ length: 9 }, (_, 添字) => cookingStepOf(`${添字 + 1}番目の手順`)),
    });

    expect(generated.ingredients.length).toBe(13);
    expect(generated.steps.length).toBe(9);
  });

  it('常備調味料の名称でも、主材料として渡されたら主材料のまま扱う', () => {
    // B-15 規則14 / prompt-design 6.3 / ADR-023: 常備調味料リストによる種別の
    // 倒し込みは腐敗防止層の仕事であり、ここでは課さない。
    const generated = generatedMeal({ ingredients: [主材料('しょうゆ')] });

    expect(generated.ingredients[0]?.kind).toBe('main');
  });

  it('同じ名称の材料が2件あっても拒まない', () => {
    // B-15 規則14 / prompt-design 6.3 / 先行 Meal.test.ts: 重複の除去は腐敗防止層の
    // 正規化であって、domain-model 4章の不変条件ではない。
    const generated = generatedMeal({ ingredients: [主材料('にんじん'), 主材料('にんじん')] });

    expect(generated.ingredients.length).toBe(2);
  });
});
