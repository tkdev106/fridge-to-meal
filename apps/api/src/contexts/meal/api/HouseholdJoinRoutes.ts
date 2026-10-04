// 招待で世帯に参加する経路（B-74 設計書 4章・5章 / FR-45 / ADR-032）。
//
// 呼んでよいのは usecase だけであり、`domain/` も `shared/domain/` も `identity/` の何も
// import しない（ADR-003 / ADR-032）。世帯の型はユースケースのシグネチャから導出する。

import type { AcceptHouseholdInvitationInput, ErrorResponseDto } from '@fridge-to-meal/contract';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractAccessToken } from './AccessToken.js';
import { statusOfThrown } from './RuleViolationStatus.js';
import type { AcceptHouseholdInvitation } from '../usecase/AcceptHouseholdInvitation.js';
import { logUnexpectedFailure } from '../../../shared/api/UnexpectedFailureLog.js';

/** 世帯の型はユースケースから引く（ADR-032 決定1）。 */
export type HouseholdJoinRoutesDeps = {
  identifyHousehold: (accessToken: string) => Promise<Parameters<AcceptHouseholdInvitation>[0]>;
  acceptHouseholdInvitation: AcceptHouseholdInvitation;
};

/**
 * 参加の1経路（`POST /household/join`）を持つサブアプリを組み立てる。
 * **接頭辞は付けない** — マウント先は `main.ts` が決める（ADR-048 決定4）。
 */
export function createHouseholdJoinRoutes(deps: HouseholdJoinRoutesDeps): Hono {
  // `new` してよいのは Hono だけである（ADR-002）。
  const routes = new Hono();

  /**
   * 招待で参加する（FR-45）。**世帯を定めるのが常に先で**、本体を読むのは認証を通ったあと
   * （設計書 規則13・16 / NFR-09）。世帯は本体から読まない（C-9）。通った回は **204 で本体を持たない**。
   */
  routes.post('/household/join', async (c) => {
    try {
      // `Request` / `Context` はここに閉じ、ユースケースには世帯とトークンだけを渡す（ADR-003）。
      const household = await deps.identifyHousehold(
        extractAccessToken(c.req.header('Authorization')),
      );

      const body = await readBody(c);
      if ('rejection' in body) return c.json(body.rejection, 400);

      const parsedInput = toAcceptHouseholdInvitationInput(body.parsed);
      if ('rejection' in parsedInput) return c.json(parsedInput.rejection, 400);

      await deps.acceptHouseholdInvitation(household, parsedInput.input.token);

      // 204 は本体を持てない。`c.json` では本体が付いてしまう（先行 `HouseholdDataRoutes`）。
      return c.body(null, 204);
    } catch (thrown) {
      return reject(c, thrown);
    }
  });

  return routes;
}

/** 本体を JSON として読む。読めなければ `request.notJson`（先行 `StockItemRoutes`）。 */
async function readBody(
  c: Context,
): Promise<{ parsed: unknown } | { rejection: ErrorResponseDto }> {
  try {
    return { parsed: (await c.req.json()) as unknown };
  } catch {
    return { rejection: { rule: 'request.notJson' } };
  }
}

/** 項目を読み出せる形か。配列も `null` もここで落ちる。 */
function toFields(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/**
 * 参加の本体の**形だけ**を見る（設計書 規則15）。空文字や空白も形として通す — 使えない招待として
 * 断るのは DB の関数である。知らない項目は断らずに無視する。
 */
function toAcceptHouseholdInvitationInput(
  body: unknown,
): { input: AcceptHouseholdInvitationInput } | { rejection: ErrorResponseDto } {
  const fields = toFields(body);
  if (fields === null || typeof fields.token !== 'string') {
    return { rejection: { rule: 'request.invalidBody' } };
  }
  return { input: { token: fields.token } };
}

/**
 * 投げられたものを応答に写す。表は献立の他の経路と同じもの（`RuleViolationStatus.ts`）。
 *
 * **写せない失敗は 500 の `unexpected` に畳み、`message` を本体に出さない**
 * （NFR-09 / ADR-045 決定3）。
 */
function reject(c: Context, thrown: unknown) {
  const mappedError = statusOfThrown(thrown);
  if (mappedError !== null) return c.json(mappedError.body, mappedError.status);

  // 応答には原因を出さない代わりに、サーバのログにだけ種類を残す（ADR-080）。
  logUnexpectedFailure(thrown);
  return c.json({ rule: 'unexpected' } satisfies ErrorResponseDto, 500);
}
