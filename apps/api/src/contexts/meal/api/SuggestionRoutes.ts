// 提案の3経路（B-48b / B-58 / FR-16 / FR-21 / FR-36 / ADR-051 / ADR-065）。
//
// 呼んでよいのは usecase だけであり、`domain/` も `shared/domain/` も `identity/` の何も
// import しない（ADR-003 / ADR-032）。世帯と基準日時の型はユースケースのシグネチャから導出する。

import type { ErrorResponseDto, SuggestMealsOutput } from '@fridge-to-meal/contract';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractAccessToken } from './AccessToken.js';
import { statusOfThrown } from './RuleViolationStatus.js';
import type { SuggestMeals, SuggestNewMeals } from '../usecase/SuggestMeals.js';
import type { ShowLatestSuggestion } from '../usecase/ShowLatestSuggestion.js';

/** 世帯は**中身を見ない値**として扱う。型はユースケースから引く（ADR-032 の決定1）。 */
type HouseholdIdParam = Parameters<SuggestMeals>[0];

/** 基準日時。型はユースケースの第2引数から引く。 */
type AsOfParam = Parameters<SuggestMeals>[1];

export type SuggestionRoutesDeps = {
  identifyHousehold: (accessToken: string) => Promise<HouseholdIdParam>;
  suggestMeals: SuggestMeals;
  suggestNewMeals: SuggestNewMeals;
  /** 保存済みの提案を読み取り専用で返す口（B-58）。**生成を呼ばない。** */
  showLatestSuggestion: ShowLatestSuggestion;
  /** 要求の基準日時。main.ts（B-48c）が時計から組む。本体では時計を読まない（testing.md 5章） */
  now: () => AsOfParam;
};

/**
 * 提案の3経路を持つサブアプリを組み立てる。**接頭辞は付けない** — マウント先は B-48c が決める。
 *
 * **生成を呼びうる2本は `POST` に置く**（ADR-062 決定1）— 提案は保存と生成の費用を伴い、
 * 安全な method に載せない。**保存済みを読むだけの1本は `GET` である**（ADR-065 決定2）— 費用も
 * 副作用も無く、`POST` に揃える理由がその2つに支えられているためである。
 * **要求の本体もクエリも読まない**（規則3・4）— 世帯はアクセストークンから、基準日時は
 * サーバの時刻から定まり、利用者が動かせる入力はこの3経路に無い。
 * 結末はすべて 200 で、出力をそのまま返す（ADR-041 / ADR-062 決定2 / ADR-065 決定3）。
 */
export function createSuggestionRoutes(deps: SuggestionRoutesDeps): Hono {
  // `new` してよいのは Hono だけである（ADR-002）。
  const routes = new Hono();

  /**
   * 1つの経路の中身。世帯を定めるのが常に先で（規則2 / NFR-09）、認証を通らない要求では
   * ユースケースを呼ばない — 生成の費用を使わせない（NFR-C2）。基準日時は要求ごとに読む（規則4）。
   */
  const handle = async (
    c: Context,
    suggest: (householdId: HouseholdIdParam, asOf: AsOfParam) => Promise<SuggestMealsOutput>,
  ) => {
    try {
      // `Request` / `Context` はここに閉じ、ユースケースには世帯と基準日時だけを渡す（ADR-003）。
      const household = await deps.identifyHousehold(
        extractAccessToken(c.req.header('Authorization')),
      );
      const asOf = deps.now();

      // 世帯は必ず第1引数（C-9）。
      const output = await suggest(household, asOf);

      return c.json(output, 200);
    } catch (thrown) {
      return reject(c, thrown);
    }
  };

  /**
   * 保存済みの提案を読み取り専用で返す（B-58 / FR-21 / NFR-03）。
   *
   * **`GET` に置く唯一の提案の経路である。** 下の2つを `POST` にしているのは保存と生成の費用を
   * 伴うためで（ADR-062 決定1）、こちらは**生成も保存もしない**ので安全な method に載せてよい。
   * 献立タブの一覧はここを叩く（2026-09-24 にユーザーが決定。ADR-065 決定1）。
   *
   * **基準日時を渡さない** — このユースケースは時刻に依存する判断を1つも持たない。
   * 結末は2つ（保存済みがある／まだ1件も無い）で、どちらも 200 である（ADR-041 / ADR-062 決定2）。
   */
  routes.get('/suggestions/latest', async (c) => {
    try {
      const household = await deps.identifyHousehold(
        extractAccessToken(c.req.header('Authorization')),
      );

      return c.json(await deps.showLatestSuggestion(household), 200);
    } catch (thrown) {
      return reject(c, thrown);
    }
  });

  routes.post('/suggestions', async (c) => await handle(c, deps.suggestMeals));

  // 明示操作（FR-36 / FR-21）。既定の提案の入口を兼ねない（ADR-051 決定2）。
  routes.post('/suggestions/new-meals', async (c) => await handle(c, deps.suggestNewMeals));

  return routes;
}

/**
 * 投げられたものを応答に写す（設計書7章）。
 *
 * **写せない失敗は 500 の `unexpected` に畳み、`message` を本体に出さない**
 * （NFR-09 / ADR-045 決定3）— 接続文字列や設定の中身が応答に漏れる経路を作らない。
 */
function reject(c: Context, thrown: unknown) {
  const mappedError = statusOfThrown(thrown);
  if (mappedError !== null) return c.json(mappedError.body, mappedError.status);

  return c.json({ rule: 'unexpected' } satisfies ErrorResponseDto, 500);
}
