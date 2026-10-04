/**
 * `/household/*`（人数・招待の作成・抜ける・参加する）を叩く口の工場と、その結末。
 *
 * **ここは画面ではない。** 経路の継ぎ目であり、`@supabase/*` も `session/` の型も触らない
 * （ADR-046 決定3）。**世帯は1つも運ばない**（C-9 / NFR-09）。
 *
 * 人数・招待・抜けるの3つは本体を送らないので `Content-Type` を付けない（ADR-048）。断り（409 を含む）は
 * `rule` を読まず失敗に畳む（先行 `deleteHouseholdData`）。参加するだけは本体 `{ token }` を送り、
 * 断りの `rule` を運ぶ — 使えないリンクと、すでに共有している場合を画面が出し分けるため。**例外を外に出さない。** 自分では
 * 送り直さない — 呼ばれた1回で1往復だけする。
 */
import type {
  AcceptHouseholdInvitationInput,
  ErrorResponseDto,
  HouseholdInvitationOutput,
  HouseholdMemberCountOutput,
} from '@fridge-to-meal/contract';
import type { HttpFetch, HttpResponse } from './HttpFetch.js';

export type HouseholdRequestsDeps = {
  readonly baseUrl: string;
  /** `Session.accessToken` を渡す。継ぎ目の型そのものは受け取らない */
  readonly accessToken: () => Promise<string | null>;
  readonly httpFetch?: HttpFetch; // 既定は実行環境の fetch
};

/** 世帯の人数を取りに行った結末（FR-47）。 */
export type ShowHouseholdMemberCountOutcome =
  { readonly outcome: 'loaded'; readonly memberCount: number } | { readonly outcome: 'failed' };

/** 招待を作った結末（FR-44）。 */
export type CreateHouseholdInvitationOutcome =
  { readonly outcome: 'created'; readonly token: string } | { readonly outcome: 'failed' };

/** 世帯を抜けた結末（FR-46）。 */
export type LeaveHouseholdOutcome = { readonly outcome: 'left' } | { readonly outcome: 'failed' };

/** 世帯に参加した結末（FR-45）。 */
export type JoinHouseholdOutcome =
  | { readonly outcome: 'joined' }
  | { readonly outcome: 'rejected'; readonly rule: string }
  | { readonly outcome: 'failed' };

export type ShowHouseholdMemberCount = () => Promise<ShowHouseholdMemberCountOutcome>;
export type CreateHouseholdInvitation = () => Promise<CreateHouseholdInvitationOutcome>;
export type LeaveHousehold = () => Promise<LeaveHouseholdOutcome>;
export type JoinHousehold = (token: string) => Promise<JoinHouseholdOutcome>;

/** 叩く先。**接頭辞を web の側で足さない**（ADR-048 決定4）。 */
const MEMBER_COUNT_PATH = '/household/member-count';
const INVITATIONS_PATH = '/household/invitations';
const LEAVE_PATH = '/household/leave';
const JOIN_PATH = '/household/join';

/** 畳んだ失敗（先行 `MealRequests` の `FAILED`）。 */
const FAILED = { outcome: 'failed' } as const;

/** 既定の出口。**実行環境の `fetch` をそのまま使う**（先行 `MealRequests`）。 */
const environmentHttpFetch: HttpFetch = (url, init) => fetch(url, init);

/**
 * 本体なしの要求を1つ出す。トークンが `null` なら**要求を出さず** `null` を返す
 * （先行 `listStockItems`）。**空文字は `null` と同じに扱わない。** 例外は呼ぶ側が畳む。
 */
async function sendWithoutBody(
  deps: HouseholdRequestsDeps,
  path: string,
  method: 'GET' | 'POST',
): Promise<HttpResponse | null> {
  const { baseUrl, accessToken, httpFetch = environmentHttpFetch } = deps;
  const token = await accessToken();

  if (token === null) {
    return null;
  }

  return httpFetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
}

function isRejection(body: unknown): body is ErrorResponseDto {
  return (
    typeof body === 'object' && body !== null && 'rule' in body && typeof body.rule === 'string'
  );
}

function isMemberCount(body: unknown): body is HouseholdMemberCountOutput {
  return (
    typeof body === 'object' &&
    body !== null &&
    'memberCount' in body &&
    typeof body.memberCount === 'number'
  );
}

function isInvitation(body: unknown): body is HouseholdInvitationOutput {
  return (
    typeof body === 'object' && body !== null && 'token' in body && typeof body.token === 'string'
  );
}

/** 世帯の人数を取りに行く口を組む（FR-47）。**人数を補正しない。** */
export function showHouseholdMemberCount(deps: HouseholdRequestsDeps): ShowHouseholdMemberCount {
  return async () => {
    try {
      const response = await sendWithoutBody(deps, MEMBER_COUNT_PATH, 'GET');

      if (response === null || !response.ok) {
        return FAILED;
      }

      const body = await response.json();

      return isMemberCount(body) ? { outcome: 'loaded', memberCount: body.memberCount } : FAILED;
    } catch {
      return FAILED;
    }
  };
}

/** 招待を作る口を組む（FR-44）。 */
export function createHouseholdInvitation(deps: HouseholdRequestsDeps): CreateHouseholdInvitation {
  return async () => {
    try {
      const response = await sendWithoutBody(deps, INVITATIONS_PATH, 'POST');

      if (response === null || !response.ok) {
        return FAILED;
      }

      const body = await response.json();

      return isInvitation(body) ? { outcome: 'created', token: body.token } : FAILED;
    } catch {
      return FAILED;
    }
  };
}

/**
 * 世帯を抜ける口を組む（FR-46）。**通った回の本体を読まない** — 相手は 204 で本体を返さない。
 * 自分しか居ない断り（409）も失敗に畳む（ADR-087 決定6）。
 */
export function leaveHousehold(deps: HouseholdRequestsDeps): LeaveHousehold {
  return async () => {
    try {
      const response = await sendWithoutBody(deps, LEAVE_PATH, 'POST');

      return response?.ok === true ? { outcome: 'left' } : FAILED;
    } catch {
      return FAILED;
    }
  };
}

/**
 * 招待のトークンで世帯に参加する口を組む（FR-45）。**通った回の本体を読まない** — 相手は 204 で
 * 本体を返さない。断りは `rule` をそのまま運び、どの案内を出すかは画面が決める（ADR-032 決定3）。
 */
export function joinHousehold(deps: HouseholdRequestsDeps): JoinHousehold {
  return async (invitationToken) => {
    const { baseUrl, accessToken, httpFetch = environmentHttpFetch } = deps;

    try {
      const token = await accessToken();

      if (token === null) {
        return FAILED;
      }

      const input: AcceptHouseholdInvitationInput = { token: invitationToken };
      const response = await httpFetch(`${baseUrl}${JOIN_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (response.ok) {
        return { outcome: 'joined' };
      }

      const body = await response.json();

      return isRejection(body) ? { outcome: 'rejected', rule: body.rule } : FAILED;
    } catch {
      return FAILED;
    }
  };
}
