import { describe, expect, it } from 'vitest';
import { mealCoverageOf } from '../../../../src/contexts/meal/domain/service/MealCoverageService.js';
import {
  createMealIngredient,
  type MealIngredient,
} from '../../../../src/contexts/meal/domain/value/MealIngredient.js';

/** 主材料。突き合わせの対象になる側（C-16）。 */
function 主材料(name: string) {
  return createMealIngredient({ name, kind: 'main' });
}

/** 調味料。常備されている前提なので突き合わせに載せない（C-16 / ADR-023）。 */
function 調味料(name: string) {
  return createMealIngredient({ name, kind: 'seasoning' });
}

/** 検証の本題は名称の並びなので、材料の列を名称の列にして見る。 */
function 名称の並び(ingredients: readonly MealIngredient[]) {
  return ingredients.map((ingredient) => ingredient.name);
}

describe('充足 MealCoverage', () => {
  it('在庫にある主材料を賄えるものとして返す', () => {
    // B-13 規則2 / C-6 / FR-17: 突き合わせは名称の完全一致で行う。
    const coverage = mealCoverageOf([主材料('にんじん'), 主材料('豚こま肉')], ['にんじん']);

    expect(名称の並び(coverage.covered)).toEqual(['にんじん']);
  });

  it('在庫にない主材料を不足するものとして返す', () => {
    // B-13 規則2 / C-6 / FR-17: 在庫に無い主材料は不足になる。
    const coverage = mealCoverageOf([主材料('にんじん'), 主材料('豚こま肉')], ['にんじん']);

    expect(名称の並び(coverage.missing)).toEqual(['豚こま肉']);
  });

  it('在庫にある調味料を賄えるものに数えない', () => {
    // C-16 / ADR-023 / B-13 規則1: 調味料は常備の前提。賄えるものとしても数えない。
    const coverage = mealCoverageOf(
      [主材料('にんじん'), 調味料('しょうゆ')],
      ['にんじん', 'しょうゆ'],
    );

    expect(名称の並び(coverage.covered)).toEqual(['にんじん']);
  });

  it('在庫にない調味料を不足するものに数えない', () => {
    // C-16 / ADR-023 / B-13 規則1: 調味料が在庫に無くても不足にはしない。
    const coverage = mealCoverageOf([主材料('にんじん'), 調味料('しょうゆ')], ['にんじん']);

    expect(coverage.missing).toEqual([]);
  });

  it('在庫品の名称の前後に空白があっても賄えるものとする', () => {
    // B-13 規則2 / C-6: 突き合わせの前に両側の前後空白を落とす。
    const coverage = mealCoverageOf([主材料('にんじん')], ['  にんじん  ']);

    expect(名称の並び(coverage.covered)).toEqual(['にんじん']);
  });

  it('材料の名称の前後に空白があっても賄えるものとする', () => {
    // B-13 規則2 / C-6: 片側だけ正規化すると一致が静かにずれる。
    const coverage = mealCoverageOf([主材料('  にんじん  ')], ['にんじん']);

    expect(名称の並び(coverage.covered)).toEqual(['にんじん']);
  });

  it('大文字小文字だけが違う名称は一致させない', () => {
    // B-13 規則2 / C-6: 正規化は前後空白を落とすことだけ。表記ゆれは吸収しない。
    const coverage = mealCoverageOf([主材料('Bacon')], ['bacon']);

    expect(名称の並び(coverage.missing)).toEqual(['Bacon']);
    expect(coverage.covered).toEqual([]);
  });

  it('同じ名称の在庫品が何度あっても賄える主材料は増えない', () => {
    // ADR-007 / B-13 規則5: 同じ食材でも在庫品は統合されないため重複は普通に起きる。
    const coverage = mealCoverageOf([主材料('にんじん')], ['にんじん', 'にんじん', 'にんじん']);

    expect(名称の並び(coverage.covered)).toEqual(['にんじん']);
  });

  it('同じ名称の主材料が2件あれば在庫が1件でも2件とも賄えるものになる', () => {
    // ADR-010 / B-13 規則3・規則6: 分量を比較しない。不足は食材の有無だけで決まるので、
    // 一方だけを不足にする按分をしない。
    const coverage = mealCoverageOf([主材料('にんじん'), 主材料('にんじん')], ['にんじん']);

    expect(名称の並び(coverage.covered)).toEqual(['にんじん', 'にんじん']);
    expect(coverage.missing).toEqual([]);
  });

  it('空白だけの在庫品の名称は突き合わせに影響せず、例外にもしない', () => {
    // B-13 規則7 / 7章: 前後空白を落とすと空になる名称は突き合わせの対象にしない。
    const coverage = mealCoverageOf([主材料('にんじん')], ['   ']);

    expect(名称の並び(coverage.missing)).toEqual(['にんじん']);
    expect(coverage.covered).toEqual([]);
  });

  it('在庫が1件も無ければ主材料はすべて不足になる', () => {
    // B-13 規則3 / C-6: 不足かどうかは食材の有無だけで決まる。
    const coverage = mealCoverageOf([主材料('にんじん'), 主材料('豚こま肉')], []);

    expect(名称の並び(coverage.missing)).toEqual(['にんじん', '豚こま肉']);
  });

  it('材料が1件も無ければ賄えるものも不足するものも空を返す', () => {
    // B-13 規則8 / 7章: 主材料が1件以上あることは Meal 集約の不変条件であり、
    // この関数は献立を受け取らないので例外にしない。
    const coverage = mealCoverageOf([], ['にんじん']);

    expect(coverage.covered).toEqual([]);
    expect(coverage.missing).toEqual([]);
  });

  it('主材料が1件も無ければ賄えるものも不足するものも空を返す', () => {
    // B-13 規則8 / C-16: 調味料しか無い材料の列でも例外にしない。
    const coverage = mealCoverageOf([調味料('しょうゆ'), 調味料('さとう')], ['しょうゆ']);

    expect(coverage.covered).toEqual([]);
    expect(coverage.missing).toEqual([]);
  });

  it('賄えるものは渡された材料の並びをそのまま保つ', () => {
    // B-13 規則4 / C-12 の決定性: 在庫側の並びに引きずられない。
    const coverage = mealCoverageOf(
      [主材料('にんじん'), 主材料('豚こま肉'), 主材料('たまねぎ')],
      ['たまねぎ', 'にんじん'],
    );

    expect(名称の並び(coverage.covered)).toEqual(['にんじん', 'たまねぎ']);
  });

  it('不足するものは渡された材料の並びをそのまま保つ', () => {
    // B-13 規則4 / C-12 の決定性: 同じ入力からは常に同じ並びが返る。
    const coverage = mealCoverageOf(
      [主材料('にんじん'), 主材料('豚こま肉'), 主材料('たまねぎ')],
      ['にんじん'],
    );

    expect(名称の並び(coverage.missing)).toEqual(['豚こま肉', 'たまねぎ']);
  });

  it('受け取った材料の配列を書き換えない', () => {
    // B-13 規則10: 受け取った配列と要素を書き換えない。
    const ingredients = [主材料('にんじん'), 主材料('豚こま肉')];

    mealCoverageOf(ingredients, ['にんじん']);

    expect(名称の並び(ingredients)).toEqual(['にんじん', '豚こま肉']);
  });

  it('受け取った在庫品の名称の配列を書き換えない', () => {
    // B-13 規則10: 並べ替えも正規化の書き戻しもしない。
    const stockItemNames = ['たまねぎ', 'にんじん'];

    mealCoverageOf([主材料('にんじん')], stockItemNames);

    expect(stockItemNames).toEqual(['たまねぎ', 'にんじん']);
  });

  it('返した充足を書き換えられない', () => {
    // B-13 規則10 / ADR-009: 返す値は凍結する。
    const coverage = mealCoverageOf([主材料('にんじん')], ['にんじん']);

    expect(() => {
      (coverage as { covered: readonly MealIngredient[] }).covered = [];
    }).toThrow();
  });

  it('賄えるものの列と不足するものの列に要素を足せない', () => {
    // B-13 規則10 / ADR-009: 充足は都度の算出結果であり、受け取った側が積み増せる器ではない。
    const coverage = mealCoverageOf([主材料('にんじん'), 主材料('豚こま肉')], ['にんじん']);

    expect(() => {
      (coverage.covered as MealIngredient[]).push(主材料('たまねぎ'));
    }).toThrow();
    expect(() => {
      (coverage.missing as MealIngredient[]).push(主材料('たまねぎ'));
    }).toThrow();
  });
});
