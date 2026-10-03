// 献立の一覧の経路（B-54a / FR-28 / FR-29 / ADR-032 / ADR-062 / ADR-068）。
//
// 呼んでよいのは usecase だけであり、`domain/` も `shared/domain/` も `identity/` の何も
// import しない（ADR-003 / ADR-032）。世帯の型はユースケースのシグネチャから導出する。

import type { ErrorResponseDto } from '@fridge-to-meal/contract';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractAccessToken } from './AccessToken.js';
import { statusOfThrown } from './RuleViolationStatus.js';
import type { ListMeals } from '../usecase/ListMeals.js';

/**
 * **基準日時の口も在庫の口も取らない**（B-54a 規則9 / C-8）— 時刻に依存する判断が1つも無く、
 * 在庫を1件も読まないことが依存の形から読める。世帯の型はユースケースから引く（ADR-032 決定1）。
 */
export type MealListRoutesDeps = {
  identifyHousehold: (accessToken: string) => Promise<Parameters<ListMeals>[0]>;
  listMeals: ListMeals;
};

/**
 * 献立の一覧の1経路（`GET /meals`）を持つサブアプリを組み立てる。
 * **接頭辞は付けない** — マウント先は `main.ts` が決める（ADR-048 決定4）。
 *
 * **`GET` に置く** — 読み取りだけで費用も副作用も無い（先行 `GET /meals/:id`。ADR-067）。
 * `GET /meals/:id` とは経路の形が違うので、同じ根に置いても食い合わない。
 */
export function createMealListRoutes(deps: MealListRoutesDeps): Hono {
  // `new` してよいのは Hono だけである（ADR-002）。
  const routes = new Hono();

  /**
   * 世帯の献立を2列で返す（FR-28 / FR-29）。**世帯を定めるのが常に先で**（NFR-09）、
   * 認証を通らない要求ではユースケースを呼ばず DB に触れない。
   *
   * **要求の本体もクエリも1つも読まない**（規則10 / C-9 / ADR-028）— 世帯はアクセストークン
   * からだけ定まる。通った回は 200 で、**出力を詰め替えも整形もせずそのまま返す**。
   */
  routes.get('/meals', async (c) => {
    try {
      // `Request` / `Context` はここに閉じ、ユースケースには世帯だけを渡す（ADR-003）。
      const household = await deps.identifyHousehold(
        extractAccessToken(c.req.header('Authorization')),
      );

      return c.json(await deps.listMeals(household), 200);
    } catch (thrown) {
      return reject(c, thrown);
    }
  });

  return routes;
}

/**
 * 投げられたものを応答に写す。表も既定も献立の他の経路と同じものを使う
 * （`RuleViolationStatus.ts`）— **表に無い献立の規則違反は 500 である**（ADR-062 決定3）。
 *
 * **写せない失敗は 500 の `unexpected` に畳み、`message` を本体に出さない**
 * （NFR-09 / ADR-045 決定3）。
 */
function reject(c: Context, thrown: unknown) {
  const mappedError = statusOfThrown(thrown);
  if (mappedError !== null) return c.json(mappedError.body, mappedError.status);

  // 応答には原因を出さない代わりに、サーバ側のログにだけ種類とメッセージを残す（応答の規則14 / NFR-09 は
  // 変えない）。スタックと `cause` は出さない — 接続の情報が混ざりうる。
  console.error(
    'unexpected',
    thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : typeof thrown,
  );
  return c.json({ rule: 'unexpected' } satisfies ErrorResponseDto, 500);
}
