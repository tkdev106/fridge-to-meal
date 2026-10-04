// 世帯の人数を返す経路・世帯を抜ける経路・招待を作る経路（B-75 設計書 4章・5章 /
// B-74 設計書 4章・5章 / FR-44 / FR-46 / FR-47 / ADR-032）。
//
// 呼んでよいのは usecase だけであり、`domain/` も `shared/domain/` も import しない
// （ADR-003 / ADR-032）。世帯の型はユースケースのシグネチャから導出する。

import type {
  ErrorResponseDto,
  HouseholdInvitationOutput,
  HouseholdMemberCountOutput,
} from '@fridge-to-meal/contract';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractAccessToken } from './AccessToken.js';
import type { CountHouseholdMembers } from '../usecase/CountHouseholdMembers.js';
import type { CreateHouseholdInvitation } from '../usecase/CreateHouseholdInvitation.js';
import type { LeaveHousehold } from '../usecase/LeaveHousehold.js';
import { logUnexpectedFailure } from '../../../shared/api/UnexpectedFailureLog.js';

/** 世帯の型はユースケースから引く（ADR-032 決定1）。 */
export type HouseholdRoutesDeps = {
  identifyHousehold: (accessToken: string) => Promise<Parameters<LeaveHousehold>[0]>;
  countHouseholdMembers: CountHouseholdMembers;
  leaveHousehold: LeaveHousehold;
  createHouseholdInvitation: CreateHouseholdInvitation;
};

/**
 * 人数の経路（`GET /household/member-count`）・抜ける経路（`POST /household/leave`）・
 * 招待を作る経路（`POST /household/invitations`）を持つサブアプリを組み立てる。**接頭辞は付けない** — マウント先は `main.ts` が決める（ADR-048 決定4）。
 *
 * どちらも**世帯を定めるのが常に先で**、認証を通らない要求ではユースケースを呼ばず DB に触れない。
 * **要求の本体もクエリも1つも読まない** — 世帯はアクセストークンからだけ定まる（設計書 規則9 / C-9）。
 */
export function createHouseholdRoutes(deps: HouseholdRoutesDeps): Hono {
  // `new` してよいのは Hono だけである（ADR-002）。
  const routes = new Hono();

  /** 世帯の人数を返す（FR-47）。 */
  routes.get('/household/member-count', async (c) => {
    try {
      // `Request` / `Context` はここに閉じ、ユースケースには世帯だけを渡す（ADR-003）。
      const household = await deps.identifyHousehold(
        extractAccessToken(c.req.header('Authorization')),
      );

      const memberCount = await deps.countHouseholdMembers(household);

      return c.json({ memberCount } satisfies HouseholdMemberCountOutput, 200);
    } catch (thrown) {
      return reject(c, thrown);
    }
  });

  /** 世帯を抜ける（FR-46）。通った回は **204 で本体を持たない**。 */
  routes.post('/household/leave', async (c) => {
    try {
      const household = await deps.identifyHousehold(
        extractAccessToken(c.req.header('Authorization')),
      );

      await deps.leaveHousehold(household);

      // 204 は本体を持てない。`c.json` では本体が付いてしまう（先行 `HouseholdDataRoutes`）。
      return c.body(null, 204);
    } catch (thrown) {
      return reject(c, thrown);
    }
  });

  /** 招待を作る（FR-44）。トークンだけを返し、リンクの URL は web が組み立てる（ADR-087 決定4）。 */
  routes.post('/household/invitations', async (c) => {
    try {
      const household = await deps.identifyHousehold(
        extractAccessToken(c.req.header('Authorization')),
      );

      const token = await deps.createHouseholdInvitation(household);

      return c.json({ token } satisfies HouseholdInvitationOutput, 201);
    } catch (thrown) {
      return reject(c, thrown);
    }
  });

  return routes;
}

/**
 * 投げられたものを応答に写す（設計書 7章）。判別は例外クラスではなく `name` と `rule` で行う
 * （ADR-032 決定2）。自分しか居ない世帯で抜けようとした断りは 409、それ以外の認証の規則違反は
 * すべて 401 である。
 *
 * **写せない失敗は 500 の `unexpected` に畳み、`message` を本体に出さない**
 * （NFR-09 / ADR-045 決定3）。
 */
function reject(c: Context, thrown: unknown) {
  const rule = identityRuleOf(thrown);
  if (rule !== null) {
    return c.json({ rule } satisfies ErrorResponseDto, rule === 'leaveHousehold.alone' ? 409 : 401);
  }

  // 応答には原因を出さない代わりに、サーバのログにだけ種類を残す（ADR-080）。
  logUnexpectedFailure(thrown);
  return c.json({ rule: 'unexpected' } satisfies ErrorResponseDto, 500);
}

/**
 * 投げられたものを認証の規則違反として読み、その `rule` を返す。規則違反でなければ `null`。
 * **`name` と `rule` の両方がそろっていることを求める**（`rule` だけで引くと、別の層の例外を
 * 取り違える）。
 */
function identityRuleOf(thrown: unknown): string | null {
  if (typeof thrown !== 'object' || thrown === null) return null;

  const { name, rule } = thrown as { name?: unknown; rule?: unknown };
  if (name !== 'IdentityRuleViolation' || typeof rule !== 'string') return null;

  return rule;
}
