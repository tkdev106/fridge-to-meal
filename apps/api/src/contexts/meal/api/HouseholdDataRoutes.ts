// 世帯のデータを消す経路（B-56a / FR-27 / NFR-13 / ADR-032 / ADR-062）。
//
// 呼んでよいのは usecase だけであり、`domain/` も `shared/domain/` も `identity/` の何も
// import しない（ADR-003 / ADR-032）。世帯の型はユースケースのシグネチャから導出する。

import type { ErrorResponseDto } from '@fridge-to-meal/contract';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractAccessToken } from './AccessToken.js';
import { statusOfThrown } from './RuleViolationStatus.js';
import type { DeleteHouseholdData } from '../usecase/DeleteHouseholdData.js';

/** 基準日時の口を取らない（B-56a 規則9）。世帯の型はユースケースから引く（ADR-032 決定1）。 */
export type HouseholdDataRoutesDeps = {
  identifyHousehold: (accessToken: string) => Promise<Parameters<DeleteHouseholdData>[0]>;
  deleteHouseholdData: DeleteHouseholdData;
};

/**
 * 世帯のデータを消す1経路（`DELETE /household-data`）を持つサブアプリを組み立てる。
 * **接頭辞は付けない** — マウント先は `main.ts` が決める（ADR-048 決定4）。
 */
export function createHouseholdDataRoutes(deps: HouseholdDataRoutesDeps): Hono {
  // `new` してよいのは Hono だけである（ADR-002）。
  const routes = new Hono();

  /**
   * 世帯の在庫・献立・提案をすべて消す（FR-27 / NFR-13）。**世帯を定めるのが常に先で**
   * （規則11 / NFR-09）、認証を通らない要求ではユースケースを呼ばず DB に触れない。
   *
   * **要求の本体もクエリも1つも読まない**（規則9 / C-9）— 世帯はアクセストークンからだけ
   * 定まる。通った回は **204 で本体を持たない**（規則10）。消す物が無くても同じ（規則7）。
   */
  routes.delete('/household-data', async (c) => {
    try {
      // `Request` / `Context` はここに閉じ、ユースケースには世帯だけを渡す（ADR-003）。
      const household = await deps.identifyHousehold(
        extractAccessToken(c.req.header('Authorization')),
      );

      await deps.deleteHouseholdData(household);

      // 204 は本体を持てない。`c.json` では本体が付いてしまう（先行 `CookingRecordRoutes`）。
      return c.body(null, 204);
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
