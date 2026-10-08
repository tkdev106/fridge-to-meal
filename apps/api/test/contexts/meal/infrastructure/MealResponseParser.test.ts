import { describe, expect, it } from 'vitest';
import { parseMealResponse } from '../../../../src/contexts/meal/infrastructure/MealResponseParser.js';
import type { GeneratedMeal } from '../../../../src/contexts/meal/domain/value/GeneratedMeal.js';
import { createGeneratedMeal } from '../../../../src/contexts/meal/domain/value/GeneratedMeal.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { amountOf } from '../../../../src/contexts/meal/domain/value/Amount.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';

/**
 * 本題でない材料を隠して材料1件の生の形を作る。本題だけが overrides に現れる（`docs/testing.md` 6章）。
 * 応答は外から来る JSON なので、型の合わない値も渡せるよう `unknown` で受ける。
 */
function ingredient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: '豚こま肉', amount: '300g', kind: 'main', ...overrides };
}

/** 本題でない値を隠して献立1件の生の形を作る。既定のままなら検証をすべて通る。 */
function meal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: '豚こま肉の炒め',
    ingredients: [ingredient(), ingredient({ name: '醤油', amount: '大さじ1', kind: 'seasoning' })],
    steps: ['豚こま肉を切る', '醤油で炒める'],
    ...overrides,
  };
}

/** 献立の列を応答の文字列にする。 */
function responseOf(...meals: unknown[]): string {
  return JSON.stringify({ meals });
}

/** 件数は既定で3件（prompt-design 2.1 の既定）。切り方が本題のケースだけ渡す。 */
function parse(text: string, requiredCount = 3): readonly GeneratedMeal[] {
  return parseMealResponse(text, requiredCount);
}

/** 投げられたものを返す。投げなければ `undefined`。断りの規則を `toMatchObject` で見るため。 */
function rejectionOf(text: string, requiredCount = 3): unknown {
  try {
    parse(text, requiredCount);
  } catch (error) {
    return error;
  }
  return undefined;
}

/** 断りの形。引数なしの `toThrow()` は未実装のスタブでも緑になるので、名前と規則を見る（6章）。 */
const emptyRejection = { name: 'MealRuleViolation', rule: 'mealGenerator.empty' };

/** 在庫に食材が無いという断りの形（ADR-091 決定2）。 */
const noIngredientRejection = { name: 'MealRuleViolation', rule: 'mealGenerator.noIngredient' };

function titlesOf(generatedMeals: readonly GeneratedMeal[]): string[] {
  return generatedMeals.map((generatedMeal) => generatedMeal.title);
}

/** 先頭の献立の材料を、名称・分量・種別の素の形で並べる。観察のための射影であって計算ではない。 */
function ingredientsOf(
  generatedMeals: readonly GeneratedMeal[],
): { name: string; amount: string | null; kind: string }[] {
  return (generatedMeals[0]?.ingredients ?? []).map(({ name, amount, kind }) => ({
    name,
    amount,
    kind,
  }));
}

function ingredientNamesOf(generatedMeals: readonly GeneratedMeal[]): string[] {
  return ingredientsOf(generatedMeals).map(({ name }) => name);
}

function stepsOf(generatedMeals: readonly GeneratedMeal[]): string[] {
  return [...(generatedMeals[0]?.steps ?? [])];
}

/** 先頭の献立で、名称の一致する材料の種別。 */
function kindOf(generatedMeals: readonly GeneratedMeal[], name: string): string | undefined {
  return ingredientsOf(generatedMeals).find((item) => item.name === name)?.kind;
}

/** n 件の材料（すべて主材料で、名称が重ならない）。 */
function ingredientsOfCount(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) =>
    ingredient({ name: `食材${String(index + 1)}` }),
  );
}

/** n 件の手順。 */
function stepsOfCount(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `手順${String(index + 1)}`);
}

/** 捨てられる献立の隣に置く、検証を通る献立。 */
const passingTitle = '鶏むね肉の照り焼き';
const passingMeal = meal({ title: passingTitle });

describe('応答の検証 parseMealResponse', () => {
  describe('正常系と抽出（prompt-design 6.1）', () => {
    it('正しい応答から献立を名称・材料・手順の形で返す', () => {
      const text = responseOf({
        title: '豚こま肉の炒め',
        ingredients: [
          { name: '豚こま肉', amount: '300g', kind: 'main' },
          { name: '醤油', amount: '大さじ1', kind: 'seasoning' },
        ],
        steps: ['豚こま肉を切る', '醤油で炒める'],
      });

      expect(parse(text, 3)).toEqual([
        createGeneratedMeal({
          title: '豚こま肉の炒め',
          ingredients: [
            createMealIngredient({ name: '豚こま肉', kind: 'main', amount: amountOf('300g') }),
            createMealIngredient({ name: '醤油', kind: 'seasoning', amount: amountOf('大さじ1') }),
          ],
          steps: [cookingStepOf('豚こま肉を切る'), cookingStepOf('醤油で炒める')],
        }),
      ]);
    });

    it('前置きやコードブロックの記号があっても読む', () => {
      // 6.1 段階1: 最初の `{` から対応する `}` までを抜き出す
      const text = `以下が献立です。\n\`\`\`json\n${responseOf(meal())}\n\`\`\`\nいかがでしょうか。`;

      expect(titlesOf(parse(text))).toEqual(['豚こま肉の炒め']);
    });

    it('文字列の中の波括弧は JSON の終わりとして読まない', () => {
      // B-72 規則13: 文字列リテラルを考慮して対応する `}` を探す
      const text = responseOf(meal({ title: '{特製}炒め}' }));

      expect(titlesOf(parse(text))).toEqual(['{特製}炒め}']);
    });

    it('文字列の中のエスケープした引用符を文字列の終わりとして読まない', () => {
      // B-72 規則13: エスケープを考慮する
      const text = responseOf(meal({ steps: ['"強火"で炒める}'] }));

      expect(stepsOf(parse(text))).toEqual(['"強火"で炒める}']);
    });

    it('`{` が1つも無い応答は断る', () => {
      // 6.1 段階1
      expect(rejectionOf('献立を考えられませんでした')).toMatchObject(emptyRejection);
    });

    it('途中で切れた応答は断る', () => {
      // 6.1 段階1: 対応する `}` が無い
      const text = '{"meals":[{"title":"豚こま肉の炒め","ingredients":[{"name":"豚こ';

      expect(rejectionOf(text)).toMatchObject(emptyRejection);
    });

    it('対応する括弧までが JSON として読めなければ断る', () => {
      // 6.1 段階2
      const text = '{meals: [{title: "豚こま肉の炒め"}]}';

      expect(rejectionOf(text)).toMatchObject(emptyRejection);
    });

    it('meals が配列でなければ断る', () => {
      // 6.1 段階3
      const text = JSON.stringify({ meals: meal() });

      expect(rejectionOf(text)).toMatchObject(emptyRejection);
    });

    it('meals が無ければ断る', () => {
      // 6.1 段階3
      const text = JSON.stringify({ title: '豚こま肉の炒め' });

      expect(rejectionOf(text)).toMatchObject(emptyRejection);
    });

    it('最初の JSON オブジェクトだけを読む', () => {
      // 6.1 段階1: 最初の `{` から対応する `}` まで。後ろのオブジェクトは読まない
      const text = `{"note":"x"} ${responseOf(meal())}`;

      expect(rejectionOf(text)).toMatchObject(emptyRejection);
    });

    it('meals が空の配列なら、在庫に食材が無いとして断る', () => {
      // ADR-091 決定2: 空の meals は在庫に食材が無いという応答（システムプロンプト規則13）
      expect(rejectionOf(responseOf())).toMatchObject(noIngredientRejection);
    });

    it('前置きやコードブロックの記号に包まれていても、meals が空の配列なら在庫に食材が無いとして断る', () => {
      // ADR-091 決定2 / 6.1 段階1: 抜き出せた JSON の meals が空なら同じ
      const text = `在庫を確認しました。\n\`\`\`json\n${responseOf()}\n\`\`\``;

      expect(rejectionOf(text)).toMatchObject(noIngredientRejection);
    });

    it('在庫に食材が無いとして断るときの説明に応答の中身を載せない', () => {
      // NFR-11 / ADR-045 結果2: message に応答本文を載せない
      const text = `秘伝の在庫確認によれば食材がありません。\n${responseOf()}`;

      const rejection = rejectionOf(text);

      expect(rejection).toMatchObject(noIngredientRejection);
      expect((rejection as Error).message).not.toContain('秘伝の在庫確認');
    });

    it('献立と材料の余分なキーを無視して通す', () => {
      const text = responseOf(
        meal({
          note: 'おすすめ',
          ingredients: [ingredient({ memo: '国産' })],
          steps: ['豚こま肉を炒める'],
        }),
      );

      const generatedMeals = parse(text);

      expect(titlesOf(generatedMeals)).toEqual(['豚こま肉の炒め']);
      expect(ingredientsOf(generatedMeals)).toEqual([
        { name: '豚こま肉', amount: '300g', kind: 'main' },
      ]);
    });
  });

  describe('献立ごとの検証（prompt-design 6.2）', () => {
    it('名称の前後の空白を落とす', () => {
      // B-72 規則19: ドメインと同じ正規化
      expect(titlesOf(parse(responseOf(meal({ title: '  豚こま肉の炒め  ' }))))).toEqual([
        '豚こま肉の炒め',
      ]);
    });

    it('40字の名称は通す', () => {
      // 6.2: 名称は1〜40字
      const title = 'あ'.repeat(40);

      expect(titlesOf(parse(responseOf(meal({ title }))))).toEqual([title]);
    });

    it('41字の名称の献立は捨てる', () => {
      const text = responseOf(meal({ title: 'あ'.repeat(41) }), passingMeal);

      expect(titlesOf(parse(text))).toEqual([passingTitle]);
    });

    it('名称の字数はコードポイントで数える', () => {
      // B-72 規則17: 絵文字40個は UTF-16 では80単位だが、40字として通す
      const title = '🍳'.repeat(40);

      expect(titlesOf(parse(responseOf(meal({ title }))))).toEqual([title]);
    });

    it('空白だけの名称の献立しか無ければ断る', () => {
      expect(rejectionOf(responseOf(meal({ title: '   ' })))).toMatchObject(emptyRejection);
    });

    it('名称が文字列でない献立は捨てる', () => {
      const text = responseOf(meal({ title: 42 }), passingMeal);

      expect(titlesOf(parse(text))).toEqual([passingTitle]);
    });

    it('オブジェクトでない要素は捨てる', () => {
      const text = responseOf(null, '豚こま肉の炒め', passingMeal);

      expect(titlesOf(parse(text))).toEqual([passingTitle]);
    });

    it('材料が配列でない献立は捨てる', () => {
      const text = responseOf(meal({ ingredients: ingredient() }), passingMeal);

      expect(titlesOf(parse(text))).toEqual([passingTitle]);
    });

    it('材料が0件の献立は捨てる', () => {
      const text = responseOf(meal({ ingredients: [] }), passingMeal);

      expect(titlesOf(parse(text))).toEqual([passingTitle]);
    });

    it('材料12件の献立は通す', () => {
      // 6.2: 材料は1〜12件
      const text = responseOf(meal({ ingredients: ingredientsOfCount(12) }));

      expect(ingredientsOf(parse(text))).toHaveLength(12);
    });

    it('材料13件の献立は捨てる', () => {
      const text = responseOf(meal({ ingredients: ingredientsOfCount(13) }), passingMeal);

      expect(titlesOf(parse(text))).toEqual([passingTitle]);
    });

    it('材料の件数は不正な材料を捨てる前の件数で数える', () => {
      // B-72 規則14: 受け取った件数で数える。13件のうち1件を捨てても12件には数えない
      const ingredients = [...ingredientsOfCount(12), ingredient({ name: '' })];
      const text = responseOf(meal({ ingredients }), passingMeal);

      expect(titlesOf(parse(text))).toEqual([passingTitle]);
    });

    it('手順が配列でない献立は捨てる', () => {
      const text = responseOf(meal({ steps: '豚こま肉を炒める' }), passingMeal);

      expect(titlesOf(parse(text))).toEqual([passingTitle]);
    });

    it('手順が0件の献立は捨てる', () => {
      const text = responseOf(meal({ steps: [] }), passingMeal);

      expect(titlesOf(parse(text))).toEqual([passingTitle]);
    });

    it('手順8件の献立は通す', () => {
      // 6.2: 手順は1〜8件
      const text = responseOf(meal({ steps: stepsOfCount(8) }));

      expect(stepsOf(parse(text))).toHaveLength(8);
    });

    it('手順9件の献立は捨てる', () => {
      const text = responseOf(meal({ steps: stepsOfCount(9) }), passingMeal);

      expect(titlesOf(parse(text))).toEqual([passingTitle]);
    });

    it('手順の件数は不正な手順を捨てる前の件数で数える', () => {
      // B-72 規則14: 受け取った件数で数える。9件のうち1件を捨てても8件には数えない
      const steps = [...stepsOfCount(8), ''];
      const text = responseOf(meal({ steps }), passingMeal);

      expect(titlesOf(parse(text))).toEqual([passingTitle]);
    });
  });

  describe('材料の検証（prompt-design 6.2 / 6.3）', () => {
    it('材料名の前後の空白を落とす', () => {
      const text = responseOf(meal({ ingredients: [ingredient({ name: '  豚こま肉  ' })] }));

      expect(ingredientNamesOf(parse(text))).toEqual(['豚こま肉']);
    });

    it('空白だけの材料名の材料は捨て、他の材料は残す', () => {
      const text = responseOf(
        meal({ ingredients: [ingredient({ name: '   ' }), ingredient({ name: 'にんじん' })] }),
      );

      expect(ingredientNamesOf(parse(text))).toEqual(['にんじん']);
    });

    it('30字の材料名は通す', () => {
      // 6.2: 材料名は1〜30字
      const name = 'あ'.repeat(30);
      const text = responseOf(meal({ ingredients: [ingredient({ name })] }));

      expect(ingredientNamesOf(parse(text))).toEqual([name]);
    });

    it('31字の材料名の材料は捨てる', () => {
      const text = responseOf(
        meal({
          ingredients: [ingredient({ name: 'あ'.repeat(31) }), ingredient({ name: 'にんじん' })],
        }),
      );

      expect(ingredientNamesOf(parse(text))).toEqual(['にんじん']);
    });

    it('名称が文字列でない材料は捨てる', () => {
      const text = responseOf(
        meal({ ingredients: [ingredient({ name: 7 }), ingredient({ name: 'にんじん' })] }),
      );

      expect(ingredientNamesOf(parse(text))).toEqual(['にんじん']);
    });

    it('名称の通る材料が1件も残らない献立しか無ければ断る', () => {
      const text = responseOf(
        meal({ ingredients: [ingredient({ name: '' }), ingredient({ name: null })] }),
      );

      expect(rejectionOf(text)).toMatchObject(emptyRejection);
    });

    it('分量の前後の空白を落とす', () => {
      const text = responseOf(meal({ ingredients: [ingredient({ amount: '  300g  ' })] }));

      expect(ingredientsOf(parse(text))).toEqual([
        { name: '豚こま肉', amount: '300g', kind: 'main' },
      ]);
    });

    it('空文字の分量は分量なしにする', () => {
      // ADR-010: 空の分量は null
      const text = responseOf(meal({ ingredients: [ingredient({ amount: '' })] }));

      expect(ingredientsOf(parse(text))).toEqual([
        { name: '豚こま肉', amount: null, kind: 'main' },
      ]);
    });

    it('空白だけの分量は分量なしにする', () => {
      const text = responseOf(meal({ ingredients: [ingredient({ amount: '   ' })] }));

      expect(ingredientsOf(parse(text))).toEqual([
        { name: '豚こま肉', amount: null, kind: 'main' },
      ]);
    });

    it('分量のキーが無い材料は分量なしで残す', () => {
      const text = responseOf(meal({ ingredients: [{ name: '豚こま肉', kind: 'main' }] }));

      expect(ingredientsOf(parse(text))).toEqual([
        { name: '豚こま肉', amount: null, kind: 'main' },
      ]);
    });

    it('文字列でない分量は分量なしにする', () => {
      const text = responseOf(meal({ ingredients: [ingredient({ amount: 300 })] }));

      expect(ingredientsOf(parse(text))).toEqual([
        { name: '豚こま肉', amount: null, kind: 'main' },
      ]);
    });

    it('30字の分量は残す', () => {
      const amount = 'あ'.repeat(30);
      const text = responseOf(meal({ ingredients: [ingredient({ amount })] }));

      expect(ingredientsOf(parse(text))).toEqual([{ name: '豚こま肉', amount, kind: 'main' }]);
    });

    it('31字の分量は分量なしに丸め、材料は捨てない', () => {
      // B-72 規則15: 分量が長いことは材料を捨てる理由にしない
      const text = responseOf(meal({ ingredients: [ingredient({ amount: 'あ'.repeat(31) })] }));

      expect(ingredientsOf(parse(text))).toEqual([
        { name: '豚こま肉', amount: null, kind: 'main' },
      ]);
    });

    it('調味料と申告された材料は常備調味料の一覧に無くても調味料にする', () => {
      // D-1: 一覧は下限であって上限ではない
      const text = responseOf(
        meal({
          ingredients: [ingredient(), ingredient({ name: 'オイスターソース', kind: 'seasoning' })],
        }),
      );

      expect(kindOf(parse(text), 'オイスターソース')).toBe('seasoning');
    });

    it('種別が無い材料は主材料にする', () => {
      // B-72 規則15: 'seasoning' 以外（欠落を含む）は 'main'
      const text = responseOf(meal({ ingredients: [{ name: '豚こま肉', amount: '300g' }] }));

      expect(kindOf(parse(text), '豚こま肉')).toBe('main');
    });

    it('種別が main でも seasoning でもない材料は主材料にする', () => {
      const text = responseOf(meal({ ingredients: [ingredient({ kind: 'vegetable' })] }));

      expect(kindOf(parse(text), '豚こま肉')).toBe('main');
    });

    // D-1 の19語。定数を import せず literal で置く（期待値は実装と独立に書く。`docs/testing.md` 6章）
    it.each([
      '塩',
      'こしょう',
      '砂糖',
      '醤油',
      '味噌',
      '酢',
      'みりん',
      '酒',
      'サラダ油',
      'ごま油',
      'オリーブオイル',
      '片栗粉',
      '小麦粉',
      'だしの素',
      'コンソメ',
      '鶏がらスープの素',
      'マヨネーズ',
      'ケチャップ',
      'バター',
    ])('常備調味料の「%s」は主材料と申告されても調味料にする', (name) => {
      // D-1 / C-16 / ADR-023: 常備調味料は充足判定から外す
      const text = responseOf(
        meal({ ingredients: [ingredient(), ingredient({ name, amount: '少々', kind: 'main' })] }),
      );

      expect(kindOf(parse(text), name)).toBe('seasoning');
    });

    it('常備調味料への倒し込みは前後の空白を落とした名称で比べる', () => {
      const text = responseOf(
        meal({ ingredients: [ingredient(), ingredient({ name: ' 醤油 ', kind: 'main' })] }),
      );

      expect(kindOf(parse(text), '醤油')).toBe('seasoning');
    });

    it('常備調味料と完全一致しない名称は主材料のまま', () => {
      // C-6 と同じく完全一致で比べる。表記ゆれは吸収しない
      const text = responseOf(
        meal({ ingredients: [ingredient(), ingredient({ name: '濃口醤油', kind: 'main' })] }),
      );

      expect(kindOf(parse(text), '濃口醤油')).toBe('main');
    });

    it('同じ材料名が2件あれば最初の1件だけを残す', () => {
      // B-72 規則15: 分量も種別も最初のものを採る
      const text = responseOf(
        meal({
          ingredients: [
            ingredient({ name: '豚こま肉', amount: '300g', kind: 'main' }),
            ingredient({ name: '豚こま肉', amount: '100g', kind: 'seasoning' }),
          ],
        }),
      );

      expect(ingredientsOf(parse(text))).toEqual([
        { name: '豚こま肉', amount: '300g', kind: 'main' },
      ]);
    });

    it('材料名の重複は前後の空白を落としてから比べる', () => {
      const text = responseOf(
        meal({
          ingredients: [
            ingredient({ name: ' 豚こま肉 ', amount: '300g' }),
            ingredient({ name: '豚こま肉', amount: '100g' }),
          ],
        }),
      );

      expect(ingredientsOf(parse(text))).toEqual([
        { name: '豚こま肉', amount: '300g', kind: 'main' },
      ]);
    });

    it('主材料が1件も残らない献立しか無ければ断る', () => {
      // C-16: 主材料が無いと在庫に関わらず「作れる」と判定されてしまう
      const text = responseOf(
        meal({
          ingredients: [
            ingredient({ name: 'オイスターソース', kind: 'seasoning' }),
            ingredient({ name: '塩', kind: 'main' }),
          ],
        }),
      );

      expect(rejectionOf(text)).toMatchObject(emptyRejection);
    });

    it('材料は受け取った順のまま返す', () => {
      // B-15 規則13: 並べ替えない。主材料を先頭へ寄せもしない
      const text = responseOf(
        meal({
          ingredients: [
            ingredient({ name: '醤油', kind: 'seasoning' }),
            ingredient({ name: 'にんじん' }),
            ingredient({ name: '豚こま肉' }),
          ],
        }),
      );

      expect(ingredientNamesOf(parse(text))).toEqual(['醤油', 'にんじん', '豚こま肉']);
    });
  });

  describe('手順の検証（prompt-design 6.2 / 6.3）', () => {
    it('手順の前後の空白を落とす', () => {
      const text = responseOf(meal({ steps: ['  豚こま肉を炒める  '] }));

      expect(stepsOf(parse(text))).toEqual(['豚こま肉を炒める']);
    });

    it('空白だけの手順は捨て、他の手順は残す', () => {
      const text = responseOf(meal({ steps: ['   ', '豚こま肉を炒める'] }));

      expect(stepsOf(parse(text))).toEqual(['豚こま肉を炒める']);
    });

    it('150字の手順は通す', () => {
      // 6.2: 手順は1〜150字
      const step = 'あ'.repeat(150);

      expect(stepsOf(parse(responseOf(meal({ steps: [step] }))))).toEqual([step]);
    });

    it('151字の手順は捨てる', () => {
      const text = responseOf(meal({ steps: ['あ'.repeat(151), '豚こま肉を炒める'] }));

      expect(stepsOf(parse(text))).toEqual(['豚こま肉を炒める']);
    });

    it('文字列でない手順は捨てる', () => {
      const text = responseOf(meal({ steps: [1, '豚こま肉を炒める'] }));

      expect(stepsOf(parse(text))).toEqual(['豚こま肉を炒める']);
    });

    it('手順が1件も残らない献立しか無ければ断る', () => {
      const text = responseOf(meal({ steps: ['', 'あ'.repeat(151)] }));

      expect(rejectionOf(text)).toMatchObject(emptyRejection);
    });

    it('手順は受け取った順のまま返す', () => {
      const text = responseOf(meal({ steps: ['盛り付ける', '豚こま肉を切る', '炒める'] }));

      expect(stepsOf(parse(text))).toEqual(['盛り付ける', '豚こま肉を切る', '炒める']);
    });
  });

  describe('名称の重複と件数（prompt-design 6.2 / 6.4）', () => {
    it('同じ名称の献立は後のものを捨てる', () => {
      // C-2: 名称の完全一致で重複を落とす
      const text = responseOf(
        meal({ title: '豚こま肉の炒め', steps: ['先の手順'] }),
        meal({ title: '豚こま肉の炒め', steps: ['後の手順'] }),
      );

      const generatedMeals = parse(text);

      expect(titlesOf(generatedMeals)).toEqual(['豚こま肉の炒め']);
      expect(stepsOf(generatedMeals)).toEqual(['先の手順']);
    });

    it('名称の重複は前後の空白を落としてから比べる', () => {
      const text = responseOf(
        meal({ title: '豚こま肉の炒め', steps: ['先の手順'] }),
        meal({ title: ' 豚こま肉の炒め ', steps: ['後の手順'] }),
      );

      const generatedMeals = parse(text);

      expect(titlesOf(generatedMeals)).toEqual(['豚こま肉の炒め']);
      expect(stepsOf(generatedMeals)).toEqual(['先の手順']);
    });

    it('検証で捨てた献立の名称は重複の相手にしない', () => {
      // B-72 規則18: 比べる相手はここまでの検証を通った献立だけ
      const text = responseOf(
        meal({ title: '豚こま肉の炒め', steps: [] }),
        meal({ title: '豚こま肉の炒め', steps: ['後の手順'] }),
      );

      const generatedMeals = parse(text);

      expect(titlesOf(generatedMeals)).toEqual(['豚こま肉の炒め']);
      expect(stepsOf(generatedMeals)).toEqual(['後の手順']);
    });

    it('通った献立が求めた件数より多ければ先頭から求めた件数だけ返す', () => {
      // 6.4
      const text = responseOf(
        meal({ title: '献立A' }),
        meal({ title: '献立B' }),
        meal({ title: '献立C' }),
        meal({ title: '献立D' }),
      );

      expect(titlesOf(parse(text, 3))).toEqual(['献立A', '献立B', '献立C']);
    });

    it('名称の重複を落としてから求めた件数を採る', () => {
      // B-72 規則18: 切ってから重複を落とすと件数が欠ける
      const text = responseOf(
        meal({ title: '献立A' }),
        meal({ title: '献立A' }),
        meal({ title: '献立B' }),
        meal({ title: '献立C' }),
      );

      expect(titlesOf(parse(text, 3))).toEqual(['献立A', '献立B', '献立C']);
    });

    it('通った献立が求めた件数より少なければ通った件数だけ返す', () => {
      // prompt-design 12章 論点1: 3件に満たなくても通った件数で提案を組む
      const text = responseOf(meal({ title: '献立A' }), meal({ title: '献立B' }));

      expect(titlesOf(parse(text, 3))).toEqual(['献立A', '献立B']);
    });

    it('献立は応答の並びのまま返す', () => {
      // 並べ替えない
      const text = responseOf(
        meal({ title: '献立B' }),
        meal({ title: '献立A' }),
        meal({ title: '献立C' }),
      );

      expect(titlesOf(parse(text))).toEqual(['献立B', '献立A', '献立C']);
    });

    it('どの献立も検証を通らなければ断る', () => {
      // 6.4: 通った献立が0件
      const text = responseOf(meal({ title: '' }), meal({ ingredients: [] }), meal({ steps: [] }));

      expect(rejectionOf(text)).toMatchObject(emptyRejection);
    });

    it('断るときの説明に応答の中身を載せない', () => {
      // NFR-11 / ADR-045 結果2: message に応答本文を載せない
      const text = responseOf(meal({ title: '秘伝の豚こま肉の炒め', steps: [] }));

      const rejection = rejectionOf(text);

      expect(rejection).toMatchObject(emptyRejection);
      expect((rejection as Error).message).not.toContain('秘伝の豚こま肉の炒め');
    });
  });

  describe('在庫の名称に分量が混じった材料名（prompt-design 6.3）', () => {
    /** プロンプトに載せた在庫品。名称と分量だけを渡す。 */
    const stockItems = [
      { name: 'たまご', amount: '2コ' },
      { name: '豚こま', amount: null },
    ];

    it('在庫品の名称＋空白＋その分量に一致する材料名を在庫品の名称に直す', () => {
      const text = responseOf(meal({ ingredients: [ingredient({ name: 'たまご 2コ' })] }));

      expect(ingredientNamesOf(parseMealResponse(text, 3, stockItems))).toEqual(['たまご']);
    });

    it('分量が在庫品と違えば直さない', () => {
      const text = responseOf(meal({ ingredients: [ingredient({ name: 'たまご 3コ' })] }));

      expect(ingredientNamesOf(parseMealResponse(text, 3, stockItems))).toEqual(['たまご 3コ']);
    });

    it('在庫品の名称と完全一致する材料名はそのまま返す', () => {
      // 在庫に「たまご」と「たまご 2コ」の両方があれば、完全一致を優先して直さない
      const text = responseOf(meal({ ingredients: [ingredient({ name: 'たまご 2コ' })] }));
      const withExactName = [...stockItems, { name: 'たまご 2コ', amount: null }];

      expect(ingredientNamesOf(parseMealResponse(text, 3, withExactName))).toEqual(['たまご 2コ']);
    });

    it('在庫品を渡さなければ材料名を直さない', () => {
      const text = responseOf(meal({ ingredients: [ingredient({ name: 'たまご 2コ' })] }));

      expect(ingredientNamesOf(parse(text))).toEqual(['たまご 2コ']);
    });

    it('直した名称どうしも重複として最初の1件だけを残す', () => {
      const text = responseOf(
        meal({
          ingredients: [
            ingredient({ name: 'たまご 2コ' }),
            ingredient({ name: 'たまご', amount: '1個' }),
          ],
        }),
      );

      expect(ingredientsOf(parseMealResponse(text, 3, stockItems))).toEqual([
        { name: 'たまご', amount: '300g', kind: 'main' },
      ]);
    });
  });
});
