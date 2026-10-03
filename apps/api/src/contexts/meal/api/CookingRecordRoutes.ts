// 調理記録の経路（B-51 / FR-22 / FR-31 / ADR-032 / ADR-062）。
//
// 呼んでよいのは usecase だけであり、`domain/` も `shared/domain/` も `identity/` の何も
// import しない（ADR-003 / ADR-032）。世帯と識別子の型はユースケースのシグネチャから導出する。

import type { ErrorResponseDto } from '@fridge-to-meal/contract';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractAccessToken } from './AccessToken.js';
import { statusOfThrown } from './RuleViolationStatus.js';
import type { AddCookingRecord } from '../usecase/AddCookingRecord.js';
import { logUnexpectedFailure } from '../../../shared/api/UnexpectedFailureLog.js';

/** 世帯は**中身を見ない値**として扱う。型はユースケースから引く（ADR-032 決定1）。 */
type HouseholdIdParam = Parameters<AddCookingRecord>[0];

/** 献立の識別子も同じく中身を見ない。経路の `:id` をそのまま名乗らせる（ADR-032 決定1）。 */
type MealIdParam = Parameters<AddCookingRecord>[1];

/** 記録の日時。要求からは受け取らず、deps の `now()` を読む（B-51 規則4 / B-48b 規則4）。 */
type CookedAtParam = Parameters<AddCookingRecord>[2];

/**
 * **在庫の口を1つも取らない**（C-8 / B-51 規則9）— 記録しても在庫は減らさないことが
 * 依存の形から読める。
 */
export type CookingRecordRoutesDeps = {
  identifyHousehold: (accessToken: string) => Promise<HouseholdIdParam>;
  addCookingRecord: AddCookingRecord;
  now: () => CookedAtParam;
};

/**
 * 調理記録の1経路（`POST /meals/:id/cooking-records`）を持つサブアプリを組み立てる。
 * **接頭辞は付けない** — マウント先は `main.ts` が決める（ADR-048 決定4）。
 *
 * **記録を足す口は `POST` だけである**（規則10・11）— 別の method に同じ口を生やさない。
 */
export function createCookingRecordRoutes(deps: CookingRecordRoutesDeps): Hono {
  // `new` してよいのは Hono だけである（ADR-002）。
  const routes = new Hono();

  /**
   * 献立1件に調理記録を1件足す（FR-22 / FR-31）。**世帯を定めるのが常に先で**（規則1 /
   * NFR-09）、認証を通らない要求ではユースケースを呼ばず DB に触れない。
   *
   * **要求の本体もクエリも1つも読まない**（規則11 / C-9 / ADR-028）— 動かせる入力は経路の
   * `:id` だけで、世帯はアクセストークンから、記録の日時は deps の `now()` からだけ定まる。
   * `now()` は**要求のたびに**読む（規則4 / ADR-062 決定1）。
   *
   * `:id` は**加工せずに**識別子として渡す（ADR-026 / ADR-032 結果1）— 書式も長さも見ず、
   * 前後の空白も落とさない。percent-encoding を解くのは hono であり、ここで解き直さない。
   *
   * 通った回は **204 で本体を持たない**（規則10 / NFR-09）— 記録に識別子は無く、
   * `Location` で指せる資源も無いので、返す中身が1つも無い。
   */
  routes.post('/meals/:id/cooking-records', async (c) => {
    try {
      // `Request` / `Context` はここに閉じ、ユースケースには世帯・識別子・日時だけを渡す（ADR-003）。
      const household = await deps.identifyHousehold(
        extractAccessToken(c.req.header('Authorization')),
      );
      const mealId = c.req.param('id') as MealIdParam;

      // 世帯は必ず第1引数（C-9）。
      await deps.addCookingRecord(household, mealId, deps.now());

      // 204 は本体を持てない。`c.json` では本体が付いてしまう（先行 `deleteStockItem` の応答）。
      return c.body(null, 204);
    } catch (thrown) {
      return reject(c, thrown);
    }
  });

  return routes;
}

/**
 * 投げられたものを応答に写す（B-51 設計書7章）。表も既定も提案の経路と同じものを使う
 * （`RuleViolationStatus.ts`）— 指した献立が無い回だけが 404 で、**表に無い献立の規則違反は
 * 500 である**（ADR-062 決定3）。日時を要求から受け取らないので、起こるのはサーバ側の不備だけ。
 *
 * **写せない失敗は 500 の `unexpected` に畳み、`message` を本体に出さない**
 * （NFR-09 / ADR-045 決定3）— 接続文字列や設定の中身が応答に漏れる経路を作らない。
 */
function reject(c: Context, thrown: unknown) {
  const mappedError = statusOfThrown(thrown);
  if (mappedError !== null) return c.json(mappedError.body, mappedError.status);

  // 応答には原因を出さない代わりに、サーバのログにだけ種類を残す（ADR-080）。
  logUnexpectedFailure(thrown);
  return c.json({ rule: 'unexpected' } satisfies ErrorResponseDto, 500);
}
