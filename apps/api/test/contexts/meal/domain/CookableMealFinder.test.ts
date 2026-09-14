import { describe, expect, it } from 'vitest';
import { cookableMealsOf } from '../../../../src/contexts/meal/domain/service/CookableMealFinder.js';
import type { CookableMeal } from '../../../../src/contexts/meal/domain/value/CookableMeal.js';
import { createStockItem } from '../../../../src/contexts/meal/domain/value/StockItem.js';
import { expiryDateOf } from '../../../../src/contexts/meal/domain/value/ExpiryDate.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { createMeal } from '../../../../src/contexts/meal/domain/entity/Meal.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import { createCookingRecord } from '../../../../src/contexts/meal/domain/value/CookingRecord.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';

const 世帯識別子 = householdIdOf('11111111-1111-4111-8111-111111111111');

/** 献立の識別子。C-13 の重複除去が効く形を作り分けるため、番号で作り分ける。 */
function 識別子(番号: number) {
  return mealIdOf(`2222222${番号}-2222-4222-8222-222222222222`);
}

/** 主材料。突き合わせの対象になる側（C-16）。 */
function 主材料(name: string) {
  return createMealIngredient({ name, kind: 'main', amount: null });
}

/** 調味料。常備の前提なので突き合わせに載らない（C-16 / ADR-023）。 */
function 調味料(name: string) {
  return createMealIngredient({ name, kind: 'seasoning', amount: null });
}

/** 本題でない値を隠して献立を作る。既定は主材料1件・手順1件・調理記録なし。 */
function 献立(overrides: Partial<Parameters<typeof createMeal>[0]> = {}) {
  return createMeal({
    id: 識別子(1),
    householdId: 世帯識別子,
    title: '肉じゃが',
    ingredients: [主材料('にんじん')],
    steps: [cookingStepOf('煮る')],
    generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
    cookingRecords: [],
    ...overrides,
  });
}

/**
 * 献立側の在庫品。引数は **(名称, 期限, 分量)** の順で、期限と分量は本題のときだけ渡す。
 *
 * **`PantrySnapshot.test.ts` の同名のヘルパーは (名称, 分量, 期限) の順である。**
 * こちらは期限が本題（C-12 の並び）で、向こうは分量が本題（C-7 の一致）だからである。
 */
function 在庫品(name: string, expiryDate: string | null = null, amount: string | null = null) {
  return createStockItem({ name, amount: amountOf(amount), expiryDate: expiryDateOf(expiryDate) });
}

/** この周は並びを問わない（並びは2周目）。返った献立の名称を集合にして見る。 */
function 名称の集合(cookableMeals: readonly CookableMeal[]) {
  return new Set(cookableMeals.map((cookableMeal) => cookableMeal.meal.title));
}

/** 並びが本題のときは集合では見分けられない。返った献立の名称を並びのまま取り出す。 */
function 名称の並び(cookableMeals: readonly CookableMeal[]) {
  return cookableMeals.map((cookableMeal) => cookableMeal.meal.title);
}

/** 調理記録。並びの2段目は有無だけを見る（C-12 / 規則13）ので、日時は本題でない。 */
function 調理記録(cookedAt = '2026-09-12T12:00:00Z') {
  return createCookingRecord({ cookedAt: dateTimeOf(cookedAt) });
}

describe('作れる献立の絞り込み CookableMealFinder', () => {
  it('主材料がすべて在庫にある献立を作れる献立として返す', () => {
    // B-14b 規則6 / C-10: 不足0件のものだけが作れる献立になる。
    const meal = 献立({ ingredients: [主材料('にんじん'), 主材料('豚こま肉')] });

    const cookableMeals = cookableMealsOf([meal], [在庫品('にんじん'), 在庫品('豚こま肉')]);

    expect(cookableMeals.length).toBe(1);
    expect(cookableMeals[0]?.meal).toBe(meal);
  });

  it('主材料が1件でも在庫に無い献立は返さない', () => {
    // B-14b 規則6 / C-10: 「ほぼ作れる」は再利用の対象にしない。
    const meal = 献立({ ingredients: [主材料('にんじん'), 主材料('豚こま肉')] });

    expect(cookableMealsOf([meal], [在庫品('にんじん')])).toEqual([]);
  });

  it('作れるものと作れないものが混ざっていても、作れるものだけを返す', () => {
    // B-14b 規則6 / C-10: 絞り込みの結果だけが返る。
    const 作れる献立1 = 献立({
      id: 識別子(1),
      title: '肉じゃが',
      ingredients: [主材料('にんじん')],
    });
    const 作れない献立 = 献立({
      id: 識別子(2),
      title: 'ポトフ',
      ingredients: [主材料('にんじん'), 主材料('ソーセージ')],
    });
    const 作れる献立2 = 献立({
      id: 識別子(3),
      title: '生姜焼き',
      ingredients: [主材料('豚こま肉')],
    });

    const cookableMeals = cookableMealsOf(
      [作れる献立1, 作れない献立, 作れる献立2],
      [在庫品('にんじん'), 在庫品('豚こま肉')],
    );

    expect(cookableMeals.length).toBe(2);
    expect(名称の集合(cookableMeals)).toEqual(new Set(['肉じゃが', '生姜焼き']));
  });

  it('在庫に無い調味料があっても作れる献立として返す', () => {
    // B-14b 規則7 / C-16 / ADR-023: 調味料は常備の前提で、不足に数えない。
    const meal = 献立({ ingredients: [主材料('にんじん'), 調味料('しょうゆ')] });

    expect(cookableMealsOf([meal], [在庫品('にんじん')]).length).toBe(1);
  });

  it('期限を持たない在庫でも主材料を賄えるものとして数える', () => {
    // B-14b 規則7 / ADR-036 結果3: 突き合わせは名称だけで行う。期限の有無は
    // 賄えるかどうかに関わらない（期限は2周目の並びにだけ効く）。
    const meal = 献立({ ingredients: [主材料('にんじん')] });

    expect(cookableMealsOf([meal], [在庫品('にんじん', null)]).length).toBe(1);
  });

  it('期限が過去の在庫でも主材料を賄えるものとして数える', () => {
    // ADR-036 決定1: 基準日を引数に取らないため、期限切れを見分ける手立てを持たない。
    // 期限切れの除外は仕様に無い。
    const meal = 献立({ ingredients: [主材料('にんじん')] });

    expect(cookableMealsOf([meal], [在庫品('にんじん', '2020-01-01')]).length).toBe(1);
  });

  it('同じ MealId の献立が2件渡されても、最初に現れた1件だけを返す', () => {
    // B-14b 規則8 / C-13: 同じ献立を2度出さない。
    const 先の献立 = 献立({ id: 識別子(1), title: '肉じゃが', ingredients: [主材料('にんじん')] });
    const 後の献立 = 献立({ id: 識別子(1), title: 'カレー', ingredients: [主材料('にんじん')] });

    const cookableMeals = cookableMealsOf([先の献立, 後の献立], [在庫品('にんじん')]);

    expect(cookableMeals.length).toBe(1);
    expect(cookableMeals[0]?.meal.title).toBe('肉じゃが');
  });

  it('献立が1件も無ければ空の列を返し、例外にしない', () => {
    // B-14b 規則9 / C-15: 0件は生成へ回る正常な経路である。
    expect(cookableMealsOf([], [在庫品('にんじん'), 在庫品('豚こま肉')])).toEqual([]);
  });

  it('在庫が1件も無ければ空の列を返し、例外にしない', () => {
    // B-14b 規則9 / C-15: 手持ちが空でも例外にせず、空の列を返す。
    const 献立1 = 献立({ id: 識別子(1), title: '肉じゃが' });
    const 献立2 = 献立({ id: 識別子(2), title: 'カレー' });

    expect(cookableMealsOf([献立1, 献立2], [])).toEqual([]);
  });

  it('在庫品が分量を持っていても主材料を賄える', () => {
    // B-26 規則12 / C-6 / ADR-037 結果1: 突き合わせは名称の完全一致で行う。
    // 分量は受け取るが読まない。読むと「200g のにんじん」が「にんじん」を賄えなくなる。
    const meal = 献立({ ingredients: [主材料('にんじん')] });

    const cookableMeals = cookableMealsOf([meal], [在庫品('にんじん', null, '1本')]);

    expect(名称の並び(cookableMeals)).toEqual(['肉じゃが']);
  });
});

describe('作れる献立の並び CookableMealFinder', () => {
  it('献立が使わない在庫の期限は、その献立の並びに効かない', () => {
    // B-14b 規則10-2 / ADR-036 決定1(i): 期限の列に入るのは、その献立の主材料に
    // 一致する在庫の期限だけ。肉じゃが が使わない だいこん@09-01 は カレー の列に入る。
    const 肉じゃが = 献立({ id: 識別子(1), title: '肉じゃが', ingredients: [主材料('にんじん')] });
    const カレー = 献立({ id: 識別子(2), title: 'カレー', ingredients: [主材料('だいこん')] });

    const cookableMeals = cookableMealsOf(
      [肉じゃが, カレー],
      [在庫品('にんじん', '2026-09-20'), 在庫品('だいこん', '2026-09-01')],
    );

    expect(名称の並び(cookableMeals)).toEqual(['カレー', '肉じゃが']);
  });

  it('同じ名称の在庫が2件あっても、期限の列は1つしか伸びない', () => {
    // B-14b 規則10-1(ii) / ADR-036 結果4: 同名の在庫は1件に畳む。畳まないと
    // 肉じゃが の列が [09-14, 09-15] に伸び、買い置きの多さが順位を動かしてしまう。
    const 肉じゃが = 献立({ id: 識別子(1), title: '肉じゃが', ingredients: [主材料('にんじん')] });
    const カレー = 献立({
      id: 識別子(2),
      title: 'カレー',
      ingredients: [主材料('だいこん'), 主材料('ねぎ')],
    });

    const cookableMeals = cookableMealsOf(
      [肉じゃが, カレー],
      [
        在庫品('にんじん', '2026-09-14'),
        在庫品('にんじん', '2026-09-15'),
        在庫品('だいこん', '2026-09-14'),
        在庫品('ねぎ', '2026-09-16'),
      ],
    );

    expect(名称の並び(cookableMeals)).toEqual(['カレー', '肉じゃが']);
  });

  it('同じ名称の在庫が複数あるときは、最も早い期限を使う', () => {
    // B-14b 規則10-1(ii) / ADR-036 決定1(ii): 畳む先は最も早い期限。先に現れたほうを
    // 採ると 肉じゃが の列が [09-20] になり、カレー の下へ落ちる。
    const 肉じゃが = 献立({ id: 識別子(1), title: '肉じゃが', ingredients: [主材料('にんじん')] });
    const カレー = 献立({ id: 識別子(2), title: 'カレー', ingredients: [主材料('たまねぎ')] });

    const cookableMeals = cookableMealsOf(
      [カレー, 肉じゃが],
      [
        在庫品('にんじん', '2026-09-20'),
        在庫品('にんじん', '2026-09-14'),
        在庫品('たまねぎ', '2026-09-15'),
      ],
    );

    expect(名称の並び(cookableMeals)).toEqual(['肉じゃが', 'カレー']);
  });

  it('期限を持たない在庫は期限の列に入らない', () => {
    // B-14b 規則10-1(iii) / ADR-036 結果3: 期限未設定の在庫品は並び順に一切効かない。
    // 肉じゃが の列は [09-14] どまりで、カレー の [09-14, 09-30] より短い。
    const 肉じゃが = 献立({
      id: 識別子(1),
      title: '肉じゃが',
      ingredients: [主材料('にんじん'), 主材料('たまねぎ')],
    });
    const カレー = 献立({
      id: 識別子(2),
      title: 'カレー',
      ingredients: [主材料('だいこん'), 主材料('ねぎ')],
    });

    const cookableMeals = cookableMealsOf(
      [肉じゃが, カレー],
      [
        在庫品('にんじん', '2026-09-14'),
        在庫品('たまねぎ', null),
        在庫品('だいこん', '2026-09-14'),
        在庫品('ねぎ', '2026-09-30'),
      ],
    );

    expect(名称の並び(cookableMeals)).toEqual(['カレー', '肉じゃが']);
  });

  it('同じ名称の主材料が2つあっても、期限は列に1つしか入らない', () => {
    // B-14b 規則10-2 / ADR-010: 主材料の名称は重複を除いて数える。分量を按分しないのと
    // 同じ扱いで、同じ食材を2度書いた献立の列が長くなって順位が動くことを避ける。
    const 肉じゃが = 献立({
      id: 識別子(1),
      title: '肉じゃが',
      ingredients: [主材料('にんじん'), 主材料('にんじん')],
    });
    const カレー = 献立({
      id: 識別子(2),
      title: 'カレー',
      ingredients: [主材料('だいこん'), 主材料('ねぎ')],
    });

    const cookableMeals = cookableMealsOf(
      [肉じゃが, カレー],
      [
        在庫品('にんじん', '2026-09-14'),
        在庫品('だいこん', '2026-09-14'),
        在庫品('ねぎ', '2026-09-30'),
      ],
    );

    expect(名称の並び(cookableMeals)).toEqual(['カレー', '肉じゃが']);
  });

  it('調味料の名称に一致する在庫の期限は、期限の列に入らない', () => {
    // ADR-036 決定1(i) / C-16: 列を作る対象は主材料だけ。調味料 しょうゆ@09-14 を
    // 数えると 肉じゃが が上に来てしまう。
    const 肉じゃが = 献立({
      id: 識別子(1),
      title: '肉じゃが',
      ingredients: [主材料('にんじん'), 調味料('しょうゆ')],
    });
    const カレー = 献立({ id: 識別子(2), title: 'カレー', ingredients: [主材料('だいこん')] });

    const cookableMeals = cookableMealsOf(
      [肉じゃが, カレー],
      [
        在庫品('にんじん', '2026-09-20'),
        在庫品('しょうゆ', '2026-09-14'),
        在庫品('だいこん', '2026-09-15'),
      ],
    );

    expect(名称の並び(cookableMeals)).toEqual(['カレー', '肉じゃが']);
  });

  it('期限の列が最初に違ったところで、期限の早いほうの献立が上に来る', () => {
    // B-14b 規則11(a) / ADR-036 決定1: 列を先頭から突き合わせ、最初に違ったところで
    // 期限の早いほうが上。
    const 肉じゃが = 献立({ id: 識別子(1), title: '肉じゃが', ingredients: [主材料('にんじん')] });
    const カレー = 献立({ id: 識別子(2), title: 'カレー', ingredients: [主材料('たまねぎ')] });

    const cookableMeals = cookableMealsOf(
      [肉じゃが, カレー],
      [在庫品('にんじん', '2026-09-15'), 在庫品('たまねぎ', '2026-09-14')],
    );

    expect(名称の並び(cookableMeals)).toEqual(['カレー', '肉じゃが']);
  });

  it('期限の列が先頭から一致して片方が尽きたら、長いほうの献立が上に来る', () => {
    // B-14b 規則11(b) / ADR-036 決定1: 残っている期限のぶん、その先の線で件数が多い。
    const 肉じゃが = 献立({ id: 識別子(1), title: '肉じゃが', ingredients: [主材料('にんじん')] });
    const カレー = 献立({
      id: 識別子(2),
      title: 'カレー',
      ingredients: [主材料('にんじん'), 主材料('豚こま肉')],
    });

    const cookableMeals = cookableMealsOf(
      [肉じゃが, カレー],
      [在庫品('にんじん', '2026-09-14'), 在庫品('豚こま肉', '2026-09-30')],
    );

    expect(名称の並び(cookableMeals)).toEqual(['カレー', '肉じゃが']);
  });

  it('期限を持つ在庫を1件も使わない献立は、使う献立より下に来る', () => {
    // B-14b 規則11 / ADR-036 結果3: 空の列は、空でない列に対してつねに下になる。
    const 肉じゃが = 献立({ id: 識別子(1), title: '肉じゃが', ingredients: [主材料('たまねぎ')] });
    const カレー = 献立({ id: 識別子(2), title: 'カレー', ingredients: [主材料('にんじん')] });

    const cookableMeals = cookableMealsOf(
      [肉じゃが, カレー],
      [在庫品('にんじん', '2026-09-14'), 在庫品('たまねぎ', null)],
    );

    expect(名称の並び(cookableMeals)).toEqual(['カレー', '肉じゃが']);
  });

  it('期限の列が 09-14,09-30 → 09-14 → 09-15,09-15,09-16 → 空 の順に並ぶ', () => {
    // ADR-036 結果1 の表そのもの: 09-14 の線で 1 対 0 なので、件数が最多の 豚汁 が
    // 下に来る。件数で勝てるのは、より早い線がすべて並んだときだけである。
    const 肉じゃが = 献立({
      id: 識別子(1),
      title: '肉じゃが',
      ingredients: [主材料('にんじん'), 主材料('豚こま肉')],
    });
    const カレー = 献立({ id: 識別子(2), title: 'カレー', ingredients: [主材料('にんじん')] });
    const 豚汁 = 献立({
      id: 識別子(3),
      title: '豚汁',
      ingredients: [主材料('たまねぎ'), 主材料('じゃがいも'), 主材料('ねぎ')],
    });
    const 焼きそば = 献立({
      id: 識別子(4),
      title: '焼きそば',
      ingredients: [主材料('干ししいたけ')],
    });

    const cookableMeals = cookableMealsOf(
      [焼きそば, 豚汁, カレー, 肉じゃが],
      [
        在庫品('にんじん', '2026-09-14'),
        在庫品('豚こま肉', '2026-09-30'),
        在庫品('たまねぎ', '2026-09-15'),
        在庫品('じゃがいも', '2026-09-15'),
        在庫品('ねぎ', '2026-09-16'),
        在庫品('干ししいたけ', null),
      ],
    );

    expect(名称の並び(cookableMeals)).toEqual(['肉じゃが', 'カレー', '豚汁', '焼きそば']);
  });

  it('期限の列で差がつけば、調理記録・生成日時・識別子は順位を動かさない', () => {
    // B-14b 規則12: 4段の鍵は上から順に見て、差がついた段で決まる。下の3段はいずれも
    // カレー を上にする向きだが、第1段で 肉じゃが が勝つ。
    const 肉じゃが = 献立({
      id: 識別子(2),
      title: '肉じゃが',
      ingredients: [主材料('にんじん')],
      generatedAt: dateTimeOf('2026-09-10T12:00:00Z'),
      cookingRecords: [],
    });
    const カレー = 献立({
      id: 識別子(1),
      title: 'カレー',
      ingredients: [主材料('だいこん')],
      generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
      cookingRecords: [調理記録()],
    });

    const cookableMeals = cookableMealsOf(
      [カレー, 肉じゃが],
      [在庫品('にんじん', '2026-09-14'), 在庫品('だいこん', '2026-09-20')],
    );

    expect(名称の並び(cookableMeals)).toEqual(['肉じゃが', 'カレー']);
  });

  it('期限の列が完全に一致したら、調理記録のある献立が上に来る', () => {
    // B-14b 規則11(c) / 規則12-2 / C-12: 第1段が同点なら第2段へ送る。下の2段は
    // 肉じゃが を上にする向きなので、調理記録の有無だけで決まっていることが見える。
    const 肉じゃが = 献立({
      id: 識別子(1),
      title: '肉じゃが',
      ingredients: [主材料('にんじん')],
      generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
      cookingRecords: [],
    });
    const カレー = 献立({
      id: 識別子(2),
      title: 'カレー',
      ingredients: [主材料('だいこん')],
      generatedAt: dateTimeOf('2026-09-10T12:00:00Z'),
      cookingRecords: [調理記録()],
    });

    const cookableMeals = cookableMealsOf(
      [肉じゃが, カレー],
      [在庫品('にんじん', '2026-09-14'), 在庫品('だいこん', '2026-09-14')],
    );

    expect(名称の並び(cookableMeals)).toEqual(['カレー', '肉じゃが']);
  });

  it('調理記録の件数の多さは順位を動かさない', () => {
    // B-14b 規則13 / C-12: 第2段が見るのは有無だけ。件数で量ると 3件の カレー が
    // 上に来るが、有無では同点になり、第3段の生成日時で 肉じゃが が上になる。
    const 肉じゃが = 献立({
      id: 識別子(2),
      title: '肉じゃが',
      ingredients: [主材料('にんじん')],
      generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
      cookingRecords: [調理記録()],
    });
    const カレー = 献立({
      id: 識別子(1),
      title: 'カレー',
      ingredients: [主材料('だいこん')],
      generatedAt: dateTimeOf('2026-09-10T12:00:00Z'),
      cookingRecords: [調理記録(), 調理記録(), 調理記録()],
    });

    const cookableMeals = cookableMealsOf(
      [カレー, 肉じゃが],
      [在庫品('にんじん', '2026-09-14'), 在庫品('だいこん', '2026-09-14')],
    );

    expect(名称の並び(cookableMeals)).toEqual(['肉じゃが', 'カレー']);
  });

  it('期限の列も調理記録の有無も同じなら、生成日時の新しい献立が上に来る', () => {
    // B-14b 規則12-3 / C-12: 第3段は生成日時の降順。第4段の識別子は カレー を上に
    // する向きなので、生成日時だけで決まっていることが見える。
    const 肉じゃが = 献立({
      id: 識別子(2),
      title: '肉じゃが',
      ingredients: [主材料('にんじん')],
      generatedAt: dateTimeOf('2026-09-13T12:00:00Z'),
    });
    const カレー = 献立({
      id: 識別子(1),
      title: 'カレー',
      ingredients: [主材料('だいこん')],
      generatedAt: dateTimeOf('2026-09-10T12:00:00Z'),
    });

    const cookableMeals = cookableMealsOf(
      [カレー, 肉じゃが],
      [在庫品('にんじん', null), 在庫品('だいこん', null)],
    );

    expect(名称の並び(cookableMeals)).toEqual(['肉じゃが', 'カレー']);
  });

  it('生成日時まで同じなら、MealId の昇順で並ぶ', () => {
    // B-14b 規則12-4 / ADR-036 決定2・結果8: 1回の生成で作られた3件は generatedAt が
    // 同じになりうるため、4段目が無いと同点が残る。
    const 肉じゃが = 献立({ id: 識別子(2), title: '肉じゃが', ingredients: [主材料('にんじん')] });
    const カレー = 献立({ id: 識別子(1), title: 'カレー', ingredients: [主材料('だいこん')] });

    const cookableMeals = cookableMealsOf(
      [肉じゃが, カレー],
      [在庫品('にんじん', null), 在庫品('だいこん', null)],
    );

    expect(名称の並び(cookableMeals)).toEqual(['カレー', '肉じゃが']);
  });

  it('識別子の比較は実行環境の照合順序ではなく、コード単位の大小で行う', () => {
    // B-14b 規則15 / ADR-036 結果8: localeCompare は ICU に依存し、Workers と Node で
    // 同じ並びになる保証がない。
    const 肉じゃが = 献立({
      id: mealIdOf('a0000000-0000-4000-8000-000000000000'),
      title: '肉じゃが',
      ingredients: [主材料('にんじん')],
    });
    const カレー = 献立({
      id: mealIdOf('A0000000-0000-4000-8000-000000000000'),
      title: 'カレー',
      ingredients: [主材料('だいこん')],
    });

    const cookableMeals = cookableMealsOf(
      [肉じゃが, カレー],
      [在庫品('にんじん', null), 在庫品('だいこん', null)],
    );

    expect(名称の並び(cookableMeals)).toEqual(['カレー', '肉じゃが']);
  });

  it('上3段が同点の献立は、渡す順を入れ替えても同じ並びで返る', () => {
    // C-12 / B-14b 規則12-4: 同じ入力で並びが変わってはいけない。上3段が同点でも
    // MealId の昇順で全順序が閉じる。
    const 肉じゃが = 献立({ id: 識別子(1), title: '肉じゃが' });
    const カレー = 献立({ id: 識別子(2), title: 'カレー' });
    const 生姜焼き = 献立({ id: 識別子(3), title: '生姜焼き' });
    const 在庫 = [在庫品('にんじん', null)];

    const ある順 = cookableMealsOf([生姜焼き, 肉じゃが, カレー], 在庫);
    const 別の順 = cookableMealsOf([カレー, 生姜焼き, 肉じゃが], 在庫);

    expect(名称の並び(ある順)).toEqual(['肉じゃが', 'カレー', '生姜焼き']);
    expect(名称の並び(別の順)).toEqual(['肉じゃが', 'カレー', '生姜焼き']);
  });

  it('受け取った献立の配列を並べ替えない', () => {
    // B-14b 規則16 / C-3: 複製してから並べる。呼ぶ側が持ち続けている配列を
    // その場で並べ替えない。
    const 肉じゃが = 献立({ id: 識別子(1), title: '肉じゃが', ingredients: [主材料('にんじん')] });
    const カレー = 献立({ id: 識別子(2), title: 'カレー', ingredients: [主材料('たまねぎ')] });
    const meals = [肉じゃが, カレー];

    cookableMealsOf(meals, [在庫品('にんじん', '2026-09-15'), 在庫品('たまねぎ', '2026-09-14')]);

    expect(meals.map((meal) => meal.title)).toEqual(['肉じゃが', 'カレー']);
  });

  it('受け取った在庫の配列を並べ替えない', () => {
    // B-14b 規則16: 期限の列を作るために畳んでも、渡された在庫の配列には手を入れない。
    const stockItems = [在庫品('にんじん', '2026-09-20'), 在庫品('だいこん', '2026-09-01')];
    const 肉じゃが = 献立({ id: 識別子(1), title: '肉じゃが', ingredients: [主材料('にんじん')] });
    const カレー = 献立({ id: 識別子(2), title: 'カレー', ingredients: [主材料('だいこん')] });

    cookableMealsOf([肉じゃが, カレー], stockItems);

    expect(stockItems.map((stockItem) => stockItem.name)).toEqual(['にんじん', 'だいこん']);
  });

  it('返した列に作れる献立を足せない', () => {
    // B-14b 規則16 / ADR-009: 都度の算出結果であり、受け取った側が積み増せる器ではない。
    const cookableMeals = cookableMealsOf([献立()], [在庫品('にんじん', null)]);

    expect(() => {
      (cookableMeals as CookableMeal[]).push(cookableMeals[0] as CookableMeal);
    }).toThrow(TypeError);
  });

  it('作れる献立が4件あっても、上位3件に切らない', () => {
    // B-14b 規則17 / ADR-036 決定4・結果6: C-11 の除外も上位3件の切り取りも
    // 呼ぶ側の仕事。finder が先に切ると、除外した分を取り戻せずに3件を割る。
    const 肉じゃが = 献立({
      id: 識別子(1),
      title: '肉じゃが',
      ingredients: [主材料('にんじん'), 主材料('豚こま肉')],
    });
    const カレー = 献立({ id: 識別子(2), title: 'カレー', ingredients: [主材料('にんじん')] });
    const 豚汁 = 献立({
      id: 識別子(3),
      title: '豚汁',
      ingredients: [主材料('たまねぎ'), 主材料('じゃがいも'), 主材料('ねぎ')],
    });
    const 焼きそば = 献立({
      id: 識別子(4),
      title: '焼きそば',
      ingredients: [主材料('干ししいたけ')],
    });

    const cookableMeals = cookableMealsOf(
      [焼きそば, 豚汁, カレー, 肉じゃが],
      [
        在庫品('にんじん', '2026-09-14'),
        在庫品('豚こま肉', '2026-09-30'),
        在庫品('たまねぎ', '2026-09-15'),
        在庫品('じゃがいも', '2026-09-15'),
        在庫品('ねぎ', '2026-09-16'),
        在庫品('干ししいたけ', null),
      ],
    );

    expect(cookableMeals.length).toBe(4);
  });

  it('在庫品の分量は作れる献立の並び順に効かない', () => {
    // B-26 規則12 / ADR-036 決定1: 並びの第1段に入るのは期限だけ。分量が列に入ると、
    // 買い置きの量が順位を動かしてしまう。
    const 肉じゃが = 献立({ id: 識別子(1), title: '肉じゃが', ingredients: [主材料('にんじん')] });
    const カレー = 献立({ id: 識別子(2), title: 'カレー', ingredients: [主材料('たまねぎ')] });

    const 分量なしの在庫 = cookableMealsOf(
      [肉じゃが, カレー],
      [在庫品('にんじん', '2026-09-20'), 在庫品('たまねぎ', '2026-09-14')],
    );
    const 分量ありの在庫 = cookableMealsOf(
      [肉じゃが, カレー],
      [在庫品('にんじん', '2026-09-20', '1本'), 在庫品('たまねぎ', '2026-09-14', '3個')],
    );

    expect(名称の並び(分量なしの在庫)).toEqual(['カレー', '肉じゃが']);
    expect(名称の並び(分量ありの在庫)).toEqual(['カレー', '肉じゃが']);
  });
});
