// 献立詳細の経路（B-52 / FR-30 / FR-32 / ADR-032 / ADR-062 / ADR-067）。
//
// 呼んでよいのは usecase だけであり、`domain/` も `shared/domain/` も `identity/` の何も
// import しない（ADR-003 / ADR-032）。世帯と識別子の型はユースケースのシグネチャから導出する。

import type { ErrorResponseDto } from '@fridge-to-meal/contract';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractAccessToken } from './AccessToken.js';
import { statusOfThrown } from './RuleViolationStatus.js';
import type { ShowMeal } from '../usecase/ShowMeal.js';

/** 世帯は**中身を見ない値**として扱う。型はユースケースから引く（ADR-032 決定1）。 */
type HouseholdIdParam = Parameters<ShowMeal>[0];

/** 献立の識別子も同じく中身を見ない。経路の `:id` をそのまま名乗らせる（ADR-032 決定1）。 */
type MealIdParam = Parameters<ShowMeal>[1];

/**
 * **基準日時の口も在庫の口も取らない**（B-52 規則11 / C-8）— 時刻に依存する判断が1つも無く、
 * 在庫は読むだけで1件も変えないことが依存の形から読める。
 */
export type MealRoutesDeps = {
  identifyHousehold: (accessToken: string) => Promise<HouseholdIdParam>;
  showMeal: ShowMeal;
};

/**
 * 献立詳細の1経路（`GET /meals/:id`）を持つサブアプリを組み立てる。
 * **接頭辞は付けない** — マウント先は `main.ts` が決める（ADR-048 決定4）。
 *
 * **`GET` に置く**（B-52 規則15）— 読み取りだけで費用も副作用も無く、**ADR-062 決定1 が
 * 提案の2経路に `POST` を選んだ理由（費用と副作用）が当たらない。** 同じ読み方の先行が
 * `GET /suggestions/latest`（ADR-065 決定2）と `GET /ingredient-names`（B-50b 規則2）である。
 */
export function createMealRoutes(deps: MealRoutesDeps): Hono {
  // `new` してよいのは Hono だけである（ADR-002）。
  const routes = new Hono();

  /**
   * 献立1件を、現在の在庫での充足つきで返す（FR-30 / FR-32）。**世帯を定めるのが常に先で**
   * （規則13 / NFR-09）、認証を通らない要求ではユースケースを呼ばず DB に触れない。
   *
   * **要求の本体もクエリも1つも読まない**（規則13 / C-9 / ADR-028）— 動かせる入力は経路の
   * `:id` だけで、世帯はアクセストークンからだけ定まる。**基準日時も取らない**（規則11）。
   *
   * `:id` は**加工せずに**識別子として渡す（ADR-026 / ADR-032 結果1）— 書式も長さも見ず、
   * 前後の空白も落とさない。percent-encoding を解くのは hono であり、ここで解き直さない。
   *
   * 通った回は 200 で、**出力を詰め替えも整形もせずそのまま返す**（規則14 / B-50b 規則6）。
   */
  routes.get('/meals/:id', async (c) => {
    try {
      // `Request` / `Context` はここに閉じ、ユースケースには世帯と識別子だけを渡す（ADR-003）。
      const household = await deps.identifyHousehold(
        extractAccessToken(c.req.header('Authorization')),
      );
      const mealId = c.req.param('id') as MealIdParam;

      // 世帯は必ず第1引数（C-9）。
      return c.json(await deps.showMeal(household, mealId), 200);
    } catch (thrown) {
      return reject(c, thrown);
    }
  });

  return routes;
}

/**
 * 投げられたものを応答に写す（B-52 設計書7章）。表も既定も提案の経路と同じものを使う
 * （`RuleViolationStatus.ts`）— 指した献立が無い回だけが 404 で、**表に無い献立の規則違反は
 * 500 である**（ADR-062 決定3）。**入力を受け取る経路でも 400 を既定にしない。**
 *
 * **写せない失敗は 500 の `unexpected` に畳み、`message` を本体に出さない**
 * （NFR-09 / ADR-045 決定3）— 接続文字列や設定の中身が応答に漏れる経路を作らない。
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
