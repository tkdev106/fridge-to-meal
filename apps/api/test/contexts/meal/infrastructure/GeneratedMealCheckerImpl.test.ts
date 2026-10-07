import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeneratedMealCheckerImpl } from '../../../../src/contexts/meal/infrastructure/GeneratedMealCheckerImpl.js';
import type { GeneratedMealCheckInput } from '../../../../src/contexts/meal/domain/port/GeneratedMealChecker.js';
import { createGeneratedMeal } from '../../../../src/contexts/meal/domain/value/GeneratedMeal.js';
import type { GeneratedMeal } from '../../../../src/contexts/meal/domain/value/GeneratedMeal.js';
import { createMealIngredient } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import type { MealIngredientKind } from '../../../../src/contexts/meal/domain/value/MealIngredient.js';
import { cookingStepOf } from '../../../../src/contexts/meal/domain/value/CookingStep.js';
import {
  FixedFetchJevAnswers,
  answersOf,
  okDeliveryOf,
} from '../../../support/meal/FixedFetchJevAnswers.js';

/** 設定に与える鍵。何を渡すかを決めるのは結線（`main.ts`）であって、この層ではない。 */
const apiKey = 'jev-key';

/** 本題でない分量を隠して材料を作る。 */
function ingredient(name: string, kind: MealIngredientKind = 'main') {
  return createMealIngredient({ name, kind, amount: null });
}

/**
 * 本題でない材料と手順を隠して生成結果を作る。既定の主材料は名称に現れないので、
 * 本題でないケースでは (a) に掛からない。
 */
function generatedMeal(
  title: string,
  overrides: { mainNames?: readonly string[]; seasoningNames?: readonly string[] } = {},
): GeneratedMeal {
  const mainNames = overrides.mainNames ?? ['豚こま肉'];
  const seasoningNames = overrides.seasoningNames ?? [];
  return createGeneratedMeal({
    title,
    ingredients: [
      ...mainNames.map((name) => ingredient(name)),
      ...seasoningNames.map((name) => ingredient(name, 'seasoning')),
    ],
    steps: [cookingStepOf('焼く')],
  });
}

/** 主材料 なす・卵 で、卵が名称に2回現れる生成結果。(a) で落ちる。 */
function repeatedMainMeal(): GeneratedMeal {
  return generatedMeal('なすと卵の卵とじ', { mainNames: ['なす', '卵'] });
}

function input(
  generatedMeals: readonly GeneratedMeal[],
  avoidTitles: readonly string[] = [],
): GeneratedMealCheckInput {
  return { generatedMeals, avoidTitles };
}

/** 確かめを1つ組み、出した警告を受け取る列と一緒に返す。 */
function checkerWith(
  fetchJevAnswers: FixedFetchJevAnswers = new FixedFetchJevAnswers(),
  key: string = apiKey,
): { checker: GeneratedMealCheckerImpl; warnings: string[] } {
  const warnings: string[] = [];
  const checker = new GeneratedMealCheckerImpl(
    { apiKey: key },
    fetchJevAnswers.fetchJevAnswers,
    (line) => {
      warnings.push(line);
    },
  );
  return { checker, warnings };
}

function titlesOf(generatedMeals: readonly GeneratedMeal[]): string[] {
  return generatedMeals.map((generatedMeal) => generatedMeal.title);
}

/** 本題の確率を答える代役。 */
function answering(noulByKey: Readonly<Record<string, unknown>>): FixedFetchJevAnswers {
  return FixedFetchJevAnswers.delivering(okDeliveryOf(answersOf(noulByKey)));
}

type JevRequestBody = {
  model: string;
  state: { meals: Record<string, string>; avoid: Record<string, string> };
  questions: Record<string, { type: string; instructions: string }>;
};

/** n 番目に受け取った要求の本体。本体は文字列なのでここで読む。 */
function requestBodyOf(fetchJevAnswers: FixedFetchJevAnswers, index = 0): JevRequestBody {
  const received = fetchJevAnswers.received[index];
  if (received === undefined) {
    throw new Error(`${index + 1}件目の要求を受け取っていない`);
  }
  return JSON.parse(received.request.body) as JevRequestBody;
}

/** 確かめを1度呼び、受け取った代役を返す。 */
async function sentWith(checkInput: GeneratedMealCheckInput): Promise<FixedFetchJevAnswers> {
  const fetchJevAnswers = new FixedFetchJevAnswers();
  await checkerWith(fetchJevAnswers).checker.check(checkInput);
  return fetchJevAnswers;
}

/**
 * 飛ばす回の入力。(a) で1件落ち、(a) の結果は ['A', 'B'] になる。
 * 下の `droppingAnswers` を使えば A が落ちるので、答えを使ったかどうかが結果に現れる。
 */
function skippedCaseInput(): GeneratedMealCheckInput {
  return input([repeatedMainMeal(), generatedMeal('A'), generatedMeal('B')], ['X']);
}

/** `skippedCaseInput` の問いすべてへの答え。使われれば A を落とす。 */
const droppingAnswers = answersOf({ same_m1_a1: 0.9, same_m2_a1: 0, similar_m1_m2: 0 });

describe('GeneratedMealCheckerImpl', () => {
  describe('名称に主材料の名前を2回含むものを落とす', () => {
    // 鍵を空にして Jev の確かめを飛ばし、(a) だけを観察する（B-78 規則7）。

    it('主材料の名前を名称に2回含む生成結果を落とす', async () => {
      // ADR-089 決定2(a) / B-78 規則1
      const { checker } = checkerWith(new FixedFetchJevAnswers(), '');

      const kept = await checker.check(
        input([
          repeatedMainMeal(),
          generatedMeal('豚こま肉の生姜焼き', {
            mainNames: ['豚こま肉'],
            seasoningNames: ['醤油'],
          }),
        ]),
      );

      expect(titlesOf(kept)).toEqual(['豚こま肉の生姜焼き']);
    });

    it('主材料の名前を名称に1回だけ含むなら残す', async () => {
      // ADR-089 決定2(a): 2回以上で落とす
      const { checker } = checkerWith(new FixedFetchJevAnswers(), '');

      const kept = await checker.check(
        input([generatedMeal('なすの揚げびたし', { mainNames: ['なす'] })]),
      );

      expect(titlesOf(kept)).toEqual(['なすの揚げびたし']);
    });

    it('2つ目以降の主材料が名称に2回現れても落とす', async () => {
      // ADR-089 決定2(a): 主材料の「どれか」
      const { checker } = checkerWith(new FixedFetchJevAnswers(), '');

      const kept = await checker.check(
        input([
          generatedMeal('ピーマンとしめじの卵の卵とじ', {
            mainNames: ['ピーマン', 'しめじ', '卵'],
          }),
          generatedMeal('A'),
        ]),
      );

      expect(titlesOf(kept)).toEqual(['A']);
    });

    it('調味料の名前は名称に2回現れても数えない', async () => {
      // ADR-089 決定2(a) / C-16: 見るのは kind: 'main' だけ
      const { checker } = checkerWith(new FixedFetchJevAnswers(), '');

      const kept = await checker.check(
        input([
          generatedMeal('醤油鶏の醤油煮', { mainNames: ['鶏もも肉'], seasoningNames: ['醤油'] }),
        ]),
      );

      expect(titlesOf(kept)).toEqual(['醤油鶏の醤油煮']);
    });
  });

  describe('Jev に問うもの', () => {
    it('名称の判定で落とした生成結果を Jev に送らない', async () => {
      // B-78 規則2: 問いは (a) を通ったものだけについて作る
      const fetchJevAnswers = await sentWith(
        input([repeatedMainMeal(), generatedMeal('A'), generatedMeal('B')]),
      );

      expect(requestBodyOf(fetchJevAnswers).state.meals).toEqual({ m1: 'A', m2: 'B' });
    });

    it('名称の判定を通ったのが1件で避けたい献立が0件なら Jev を呼ばずにその1件を返す', async () => {
      // B-78 規則2: 問いが0個なら呼ばない
      const fetchJevAnswers = new FixedFetchJevAnswers();

      const kept = await checkerWith(fetchJevAnswers).checker.check(input([generatedMeal('A')]));

      expect(fetchJevAnswers.callCount).toBe(0);
      expect(titlesOf(kept)).toEqual(['A']);
    });

    it('名称の判定を通ったのが0件なら避けたい献立があっても Jev を呼ばない', async () => {
      // B-78 規則2: 問いが0個なら呼ばない
      const fetchJevAnswers = new FixedFetchJevAnswers();

      await checkerWith(fetchJevAnswers).checker.check(input([repeatedMainMeal()], ['X']));

      expect(fetchJevAnswers.callCount).toBe(0);
    });

    it('Jev を呼ばなかった回は警告を出さない', async () => {
      // B-78 規則8: 問いが0個で呼ばなかった回は飛ばしたのではない
      const { checker, warnings } = checkerWith();

      await checker.check(input([generatedMeal('A')]));

      expect(warnings).toEqual([]);
    });

    it('Jev の判定の口に POST で送る', async () => {
      // ADR-089 状況 / B-78 規則3
      const fetchJevAnswers = await sentWith(input([generatedMeal('A'), generatedMeal('B')]));

      expect(fetchJevAnswers.received[0]?.url).toBe('https://api.typesafe.ai/v1/systemone');
      expect(fetchJevAnswers.received[0]?.request.method).toBe('POST');
    });

    it('鍵を Bearer で Authorization に載せる', async () => {
      // B-78 規則3
      const fetchJevAnswers = await sentWith(input([generatedMeal('A'), generatedMeal('B')]));

      expect(fetchJevAnswers.received[0]?.request.headers['Authorization']).toBe('Bearer jev-key');
    });

    it('本体を JSON として送ると content-type で示す', async () => {
      // B-78 規則3
      const fetchJevAnswers = await sentWith(input([generatedMeal('A'), generatedMeal('B')]));

      expect(fetchJevAnswers.received[0]?.request.headers['content-type']).toBe('application/json');
    });

    it('判定のモデルに jev-latest を指定する', async () => {
      // B-78 規則3
      const fetchJevAnswers = await sentWith(input([generatedMeal('A'), generatedMeal('B')]));

      expect(requestBodyOf(fetchJevAnswers).model).toBe('jev-latest');
    });

    it('state には献立と避けたい献立の名称だけを番号つきで載せ、材料も手順も載せない', async () => {
      // B-78 規則3 / NFR-11: 外へ出すものを最小にする
      const fetchJevAnswers = await sentWith(
        input(
          [
            generatedMeal('A', { mainNames: ['鶏もも肉'], seasoningNames: ['塩'] }),
            generatedMeal('B', { mainNames: ['なす'] }),
          ],
          ['X', 'Y'],
        ),
      );

      expect(requestBodyOf(fetchJevAnswers).state).toEqual({
        meals: { m1: 'A', m2: 'B' },
        avoid: { a1: 'X', a2: 'Y' },
      });
    });

    it('献立と避けたい献立の全組と、献立どうしの全組を1回の要求で問う', async () => {
      // ADR-089 決定2 / B-78 規則2・4
      const fetchJevAnswers = await sentWith(
        input([generatedMeal('A'), generatedMeal('B'), generatedMeal('C')], ['X', 'Y']),
      );

      expect(fetchJevAnswers.callCount).toBe(1);
      expect(Object.keys(requestBodyOf(fetchJevAnswers).questions).sort()).toEqual([
        'same_m1_a1',
        'same_m1_a2',
        'same_m2_a1',
        'same_m2_a2',
        'same_m3_a1',
        'same_m3_a2',
        'similar_m1_m2',
        'similar_m1_m3',
        'similar_m2_m3',
      ]);
    });

    it('問いはすべて確率で答える型 noul で問う', async () => {
      // ADR-089 状況 / B-78 規則4
      const fetchJevAnswers = await sentWith(
        input([generatedMeal('A'), generatedMeal('B')], ['X']),
      );

      const types = Object.values(requestBodyOf(fetchJevAnswers).questions).map(
        (question) => question.type,
      );
      expect(types).toEqual(['noul', 'noul', 'noul']);
    });

    it('避けたい献立と同じかの問いは、その献立と避けたい献立を state の鍵で指す', async () => {
      // B-78 規則4
      const fetchJevAnswers = await sentWith(
        input([generatedMeal('A'), generatedMeal('B')], ['X']),
      );

      const instructions =
        requestBodyOf(fetchJevAnswers).questions['same_m2_a1']?.instructions ?? '';
      expect(instructions).toContain('meals.m2');
      expect(instructions).toContain('avoid.a1');
    });

    it('献立どうしが似ているかの問いは、2つの献立を state の鍵で指す', async () => {
      // B-78 規則4
      const fetchJevAnswers = await sentWith(input([generatedMeal('A'), generatedMeal('B')]));

      const instructions =
        requestBodyOf(fetchJevAnswers).questions['similar_m1_m2']?.instructions ?? '';
      expect(instructions).toContain('meals.m1');
      expect(instructions).toContain('meals.m2');
    });
  });

  describe('Jev の答えで落とす', () => {
    it('避けたい献立と同じである確率が 0.5 ちょうどでも落とす', async () => {
      // ADR-089 決定2(b): 0.5 以上で落とす
      const { checker } = checkerWith(
        answering({ same_m1_a1: 0.5, same_m2_a1: 0, similar_m1_m2: 0 }),
      );

      const kept = await checker.check(input([generatedMeal('A'), generatedMeal('B')], ['X']));

      expect(titlesOf(kept)).toEqual(['B']);
    });

    it('避けたい献立と同じである確率が 0.49 なら残す', async () => {
      // ADR-089 決定2(b): 0.5 未満は残す
      const { checker } = checkerWith(
        answering({ same_m1_a1: 0.49, same_m2_a1: 0, similar_m1_m2: 0 }),
      );

      const kept = await checker.check(input([generatedMeal('A'), generatedMeal('B')], ['X']));

      expect(titlesOf(kept)).toEqual(['A', 'B']);
    });

    it('前にある残した献立と似ている確率が 0.5 以上なら後ろを落とす', async () => {
      // ADR-089 決定2(c): 後の方を落とす
      const { checker } = checkerWith(answering({ similar_m1_m2: 0.5 }));

      const kept = await checker.check(input([generatedMeal('A'), generatedMeal('B')]));

      expect(titlesOf(kept)).toEqual(['A']);
    });

    it('似ていて落とした献立は、後ろの献立との比較に使わない', async () => {
      // ADR-089 決定2(c) / B-78 規則6: 比べる相手は「前にある残した献立」
      const { checker } = checkerWith(
        answering({ similar_m1_m2: 0.9, similar_m1_m3: 0, similar_m2_m3: 0.9 }),
      );

      const kept = await checker.check(
        input([generatedMeal('A'), generatedMeal('B'), generatedMeal('C')]),
      );

      expect(titlesOf(kept)).toEqual(['A', 'C']);
    });

    it('避けたい献立と同じで落とした献立も、後ろの献立との比較に使わない', async () => {
      // ADR-089 決定2(c) / B-78 規則6: 比べる相手は「前にある残した献立」
      const { checker } = checkerWith(
        answering({ same_m1_a1: 0.9, same_m2_a1: 0, similar_m1_m2: 0.9 }),
      );

      const kept = await checker.check(input([generatedMeal('A'), generatedMeal('B')], ['X']));

      expect(titlesOf(kept)).toEqual(['B']);
    });

    it('落とすものが無ければ、受け取った並びのまま全部返す', async () => {
      // ADR-089 決定1 / B-78 規則6: 並びは保つ
      const { checker } = checkerWith(
        answering({
          same_m1_a1: 0,
          same_m2_a1: 0,
          same_m3_a1: 0,
          similar_m1_m2: 0,
          similar_m1_m3: 0,
          similar_m2_m3: 0,
        }),
      );

      const kept = await checker.check(
        input([generatedMeal('A'), generatedMeal('B'), generatedMeal('C')], ['X']),
      );

      expect(titlesOf(kept)).toEqual(['A', 'B', 'C']);
    });
  });

  describe('Jev の確かめを飛ばす', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('鍵が空なら Jev を呼ばない', async () => {
      // ADR-089 決定3 / B-78 規則7
      const fetchJevAnswers = FixedFetchJevAnswers.delivering(okDeliveryOf(droppingAnswers));

      await checkerWith(fetchJevAnswers, '').checker.check(skippedCaseInput());

      expect(fetchJevAnswers.callCount).toBe(0);
    });

    it('空白だけの鍵も空として Jev を呼ばない', async () => {
      // B-78 規則7: 前後の空白を落として空なら空
      const fetchJevAnswers = FixedFetchJevAnswers.delivering(okDeliveryOf(droppingAnswers));

      await checkerWith(fetchJevAnswers, '   ').checker.check(skippedCaseInput());

      expect(fetchJevAnswers.callCount).toBe(0);
    });

    it('鍵が空なら名称の判定の結果を返し、apiKeyEmpty の警告を1行出す', async () => {
      // ADR-089 決定3 / B-78 規則7・8
      const { checker, warnings } = checkerWith(
        FixedFetchJevAnswers.delivering(okDeliveryOf(droppingAnswers)),
        '',
      );

      const kept = await checker.check(skippedCaseInput());

      expect(titlesOf(kept)).toEqual(['A', 'B']);
      expect(warnings).toEqual(['meal.generatedMealCheck.skipped apiKeyEmpty']);
    });

    it('3秒で応答が届かなければ名称の判定の結果を返し、timeout の警告を1行出す', async () => {
      // ADR-089 決定3 / B-78 規則7・8
      vi.useFakeTimers();
      const { checker, warnings } = checkerWith(FixedFetchJevAnswers.delivering({ hangs: true }));
      const checking = checker.check(skippedCaseInput());

      await vi.advanceTimersByTimeAsync(3_000);
      const kept = await checking;

      expect(titlesOf(kept)).toEqual(['A', 'B']);
      expect(warnings).toEqual(['meal.generatedMealCheck.skipped timeout']);
    });

    it('3秒に満たないうちは決着しない', async () => {
      // ADR-089 決定3: 上限は3秒ちょうどであり、それより前に切らない
      vi.useFakeTimers();
      let settled = false;
      void checkerWith(FixedFetchJevAnswers.delivering({ hangs: true }))
        .checker.check(skippedCaseInput())
        .finally(() => {
          settled = true;
        });

      await vi.advanceTimersByTimeAsync(2_999);

      expect(settled).toBe(false);
    });

    it('応答の本体を3秒で読み終えなければ名称の判定の結果を返し、timeout の警告を1行出す', async () => {
      // B-78 規則7: 3秒は本体を読み終えるまでを含む
      vi.useFakeTimers();
      const { checker, warnings } = checkerWith(
        FixedFetchJevAnswers.delivering({ jsonHangs: true }),
      );
      const checking = checker.check(skippedCaseInput());

      await vi.advanceTimersByTimeAsync(3_000);
      const kept = await checking;

      expect(titlesOf(kept)).toEqual(['A', 'B']);
      expect(warnings).toEqual(['meal.generatedMealCheck.skipped timeout']);
    });

    it('送れなければ名称の判定の結果を返し、requestFailed の警告を1行出す', async () => {
      // B-78 規則7・8
      const { checker, warnings } = checkerWith(
        FixedFetchJevAnswers.delivering({ throws: new TypeError('fetch failed') }),
      );

      const kept = await checker.check(skippedCaseInput());

      expect(titlesOf(kept)).toEqual(['A', 'B']);
      expect(warnings).toEqual(['meal.generatedMealCheck.skipped requestFailed']);
    });

    it('2xx でない応答なら名称の判定の結果を返し、httpStatus の警告を1行出す', async () => {
      // ADR-089 決定3 / B-78 規則7・8: 状態コードは警告に載せない
      const { checker, warnings } = checkerWith(
        FixedFetchJevAnswers.delivering({ ok: false, status: 500, body: droppingAnswers }),
      );

      const kept = await checker.check(skippedCaseInput());

      expect(titlesOf(kept)).toEqual(['A', 'B']);
      expect(warnings).toEqual(['meal.generatedMealCheck.skipped httpStatus']);
    });

    it('問いの鍵が1つでも答えに欠けていれば他の答えも使わず、unreadable の警告を1行出す', async () => {
      // B-78 規則5: 送った問いの鍵すべてに数があって初めて読める
      const { checker, warnings } = checkerWith(answering({ same_m1_a1: 0.9, same_m2_a1: 0 }));

      const kept = await checker.check(skippedCaseInput());

      expect(titlesOf(kept)).toEqual(['A', 'B']);
      expect(warnings).toEqual(['meal.generatedMealCheck.skipped unreadable']);
    });

    it('noul が数でなければ答えを使わず、unreadable の警告を1行出す', async () => {
      // B-78 規則5
      const { checker, warnings } = checkerWith(
        answering({ same_m1_a1: '0.9', same_m2_a1: 0, similar_m1_m2: 0 }),
      );

      const kept = await checker.check(skippedCaseInput());

      expect(titlesOf(kept)).toEqual(['A', 'B']);
      expect(warnings).toEqual(['meal.generatedMealCheck.skipped unreadable']);
    });

    it('応答の本体が JSON として読めなければ名称の判定の結果を返し、unreadable の警告を1行出す', async () => {
      // B-78 規則5・7
      const { checker, warnings } = checkerWith(
        FixedFetchJevAnswers.delivering({
          ok: true,
          status: 200,
          jsonThrows: new SyntaxError('Unexpected token'),
        }),
      );

      const kept = await checker.check(skippedCaseInput());

      expect(titlesOf(kept)).toEqual(['A', 'B']);
      expect(warnings).toEqual(['meal.generatedMealCheck.skipped unreadable']);
    });

    it('答えを使えた回は警告を出さない', async () => {
      // B-78 規則8: 警告は飛ばした回だけ
      const { checker, warnings } = checkerWith(
        FixedFetchJevAnswers.delivering(okDeliveryOf(droppingAnswers)),
      );

      await checker.check(skippedCaseInput());

      expect(warnings).toEqual([]);
    });
  });
});
