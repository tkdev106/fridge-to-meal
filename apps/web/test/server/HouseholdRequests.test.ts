/**
 * 世帯の人数・招待の作成・抜けるの3つの口（B-76 1周目 / 設計 6章 規則15 / 7章。先行
 * `HouseholdDataRequests.test.ts` の `deleteHouseholdData`）と、参加する口（B-77 1周目 /
 * 設計 6章 規則7 / 7章）。
 *
 * **観るのは戻り値と、出口が受け取った要求だけ**である（`docs/testing.md` 2章）。
 * `vi.fn()` で呼び出し回数を数えず、差し替えは `FixedHttpFetch` を渡す。
 */

import { describe, expect, it } from 'vitest';
import { FixedHttpFetch } from '../support/server/FixedHttpFetch.js';
import type { HttpDelivery } from '../support/server/FixedHttpFetch.js';
import {
  createHouseholdInvitation,
  joinHousehold,
  leaveHousehold,
  showHouseholdMemberCount,
} from '../../src/server/HouseholdRequests.js';
import type { HouseholdRequestsDeps } from '../../src/server/HouseholdRequests.js';

const BASE_URL = 'https://api.example.test';
const TOKEN = 'access-token';

/** トークンが取れる口。 */
const heldToken = () => Promise.resolve<string | null>(TOKEN);
/** トークンが取れない口。 */
const missingToken = () => Promise.resolve<string | null>(null);
/** 取り出しが投げる口。 */
const throwingToken = () => Promise.reject<string | null>(new Error('取り出せない'));

/** 口の工場と届ける応答から、出口と組んだ口を返す。 */
function requestWith<R>(
  factory: (deps: HouseholdRequestsDeps) => R,
  delivery: HttpDelivery,
  accessToken: () => Promise<string | null> = heldToken,
) {
  const httpFetch = new FixedHttpFetch(delivery);
  const request = factory({ baseUrl: BASE_URL, accessToken, httpFetch: httpFetch.httpFetch });

  return { httpFetch, request };
}

describe('世帯の人数を取りに行く継ぎ目 showHouseholdMemberCount', () => {
  const loaded: HttpDelivery = { ok: true, body: { memberCount: 2 } };

  it('本体の人数が数なら、その人数を読み込めた結末に載せる', async () => {
    // 規則15 / FR-47
    const { request } = requestWith(showHouseholdMemberCount, loaded);

    await expect(request()).resolves.toEqual({ outcome: 'loaded', memberCount: 2 });
  });

  it('人数が0でも補正せず、そのまま読み込めた結末に載せる', async () => {
    // 規則2: 値を補正しない。
    const { request } = requestWith(showHouseholdMemberCount, {
      ok: true,
      body: { memberCount: 0 },
    });

    await expect(request()).resolves.toEqual({ outcome: 'loaded', memberCount: 0 });
  });

  it('本体の人数が数でなければ、失敗の結末を返す', async () => {
    // 規則15: `memberCount` が数でなければ `failed`。
    const { request } = requestWith(showHouseholdMemberCount, {
      ok: true,
      body: { memberCount: '2' },
    });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('通った応答の本体が JSON として読めなければ、失敗の結末を返す', async () => {
    // 7章 行1: 読めない本体は失敗に畳む。
    const { request } = requestWith(showHouseholdMemberCount, {
      ok: true,
      unreadableBody: true,
    });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('基点に /household/member-count を足した先を GET で叩き、世帯を1つも載せない', async () => {
    // ADR-048 決定4: 接頭辞を web の側で足さない。C-9 / NFR-09: 世帯を経路にもクエリにも
    // 載せない — URL の完全一致で、足されたものが無いことまで見る。
    const { httpFetch, request } = requestWith(showHouseholdMemberCount, loaded);

    await request();

    expect(httpFetch.receivedRequests[0]?.url).toBe(`${BASE_URL}/household/member-count`);
    expect(httpFetch.receivedRequests[0]?.method).toBe('GET');
  });

  it('アクセストークンを Bearer で載せ、Content-Type も本体も付けない', async () => {
    // 規則15 / ADR-048: 本体を持たない要求に `Content-Type` を付けない。
    const { httpFetch, request } = requestWith(showHouseholdMemberCount, loaded);

    await request();

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(httpFetch.receivedRequests[0]?.body).toBeUndefined();
  });

  it('アクセストークンが取れなければ、失敗の結末を返す', async () => {
    // 規則15 / 7章 行1
    const { request } = requestWith(showHouseholdMemberCount, loaded, missingToken);

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンが取れなければ、要求を1つも出さない', async () => {
    // 規則15: `accessToken` が `null` なら要求を出さない（起きないことが要件。`docs/testing.md` 2章）。
    const { httpFetch, request } = requestWith(showHouseholdMemberCount, loaded, missingToken);

    await request();

    expect(httpFetch.receivedRequests).toEqual([]);
  });

  it('断りの応答は rule を運ばず、失敗の結末だけを返す', async () => {
    // 規則15: 断りは `rule` を読まず `failed` に畳む。完全一致で `rule` のキーが無いことまで見る。
    const { request } = requestWith(showHouseholdMemberCount, {
      ok: false,
      body: { rule: 'accessToken.invalid' },
    });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('出口が投げても、例外を外に出さず失敗の結末を返す', async () => {
    // 規則15 / FR-41: 通信の失敗も失敗に畳み、外へ出さない。
    const { request } = requestWith(showHouseholdMemberCount, {
      throws: new Error('到達できない'),
    });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンの取り出しが投げても、例外を外に出さず失敗の結末を返す', async () => {
    // 規則15: 例外を外へ出さない。
    const { request } = requestWith(showHouseholdMemberCount, loaded, throwingToken);

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });
});

describe('招待を作る継ぎ目 createHouseholdInvitation', () => {
  const created: HttpDelivery = { ok: true, body: { token: 'invite-token' } };

  it('本体のトークンが文字列なら、そのトークンを作れた結末に載せる', async () => {
    // 規則15 / FR-44
    const { request } = requestWith(createHouseholdInvitation, created);

    await expect(request()).resolves.toEqual({ outcome: 'created', token: 'invite-token' });
  });

  it('本体のトークンが文字列でなければ、失敗の結末を返す', async () => {
    // 規則15: `token` が文字列でなければ `failed`。
    const { request } = requestWith(createHouseholdInvitation, { ok: true, body: { token: 123 } });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('通った応答の本体が JSON として読めなければ、失敗の結末を返す', async () => {
    // 7章 行1
    const { request } = requestWith(createHouseholdInvitation, { ok: true, unreadableBody: true });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('基点に /household/invitations を足した先を POST で叩き、世帯を1つも載せない', async () => {
    // ADR-048 決定4 / C-9 / NFR-09: URL の完全一致で、足されたものが無いことまで見る。
    const { httpFetch, request } = requestWith(createHouseholdInvitation, created);

    await request();

    expect(httpFetch.receivedRequests[0]?.url).toBe(`${BASE_URL}/household/invitations`);
    expect(httpFetch.receivedRequests[0]?.method).toBe('POST');
  });

  it('アクセストークンを Bearer で載せ、Content-Type も本体も付けない', async () => {
    // 規則15 / ADR-048: 本体を持たない POST に `Content-Type` を付けない。
    const { httpFetch, request } = requestWith(createHouseholdInvitation, created);

    await request();

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(httpFetch.receivedRequests[0]?.body).toBeUndefined();
  });

  it('アクセストークンが取れなければ、失敗の結末を返す', async () => {
    // 規則15 / 7章 行1
    const { request } = requestWith(createHouseholdInvitation, created, missingToken);

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンが取れなければ、要求を1つも出さない', async () => {
    // 規則15: `accessToken` が `null` なら要求を出さない（起きないことが要件。`docs/testing.md` 2章）。
    const { httpFetch, request } = requestWith(createHouseholdInvitation, created, missingToken);

    await request();

    expect(httpFetch.receivedRequests).toEqual([]);
  });

  it('断りの応答は rule を運ばず、失敗の結末だけを返す', async () => {
    // 規則15: 断りは `rule` を読まず `failed` に畳む。
    const { request } = requestWith(createHouseholdInvitation, {
      ok: false,
      body: { rule: 'accessToken.invalid' },
    });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('出口が投げても、例外を外に出さず失敗の結末を返す', async () => {
    // 規則15 / FR-41
    const { request } = requestWith(createHouseholdInvitation, {
      throws: new Error('到達できない'),
    });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンの取り出しが投げても、例外を外に出さず失敗の結末を返す', async () => {
    // 規則15
    const { request } = requestWith(createHouseholdInvitation, created, throwingToken);

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });
});

describe('世帯を抜ける継ぎ目 leaveHousehold', () => {
  /** 通った応答1つぶん（204 を写した本体なしの応答）。 */
  const left: HttpDelivery = { ok: true, body: undefined };

  it('応答が通れば、抜けた結末を返す', async () => {
    // 規則15 / FR-46: 通った回は 204 で本体なしである。
    const { request } = requestWith(leaveHousehold, left);

    await expect(request()).resolves.toEqual({ outcome: 'left' });
  });

  it('通った応答の本体を読まないので、読めない本体でも抜けた結末を返す', async () => {
    // 規則15: 2xx は本体を読まない（先行 `deleteHouseholdData`）。
    const { request } = requestWith(leaveHousehold, { ok: true, unreadableBody: true });

    await expect(request()).resolves.toEqual({ outcome: 'left' });
  });

  it('基点に /household/leave を足した先を POST で叩き、世帯を1つも載せない', async () => {
    // ADR-048 決定4 / C-9 / NFR-09: URL の完全一致で、足されたものが無いことまで見る。
    const { httpFetch, request } = requestWith(leaveHousehold, left);

    await request();

    expect(httpFetch.receivedRequests[0]?.url).toBe(`${BASE_URL}/household/leave`);
    expect(httpFetch.receivedRequests[0]?.method).toBe('POST');
  });

  it('アクセストークンを Bearer で載せ、Content-Type も本体も付けない', async () => {
    // 規則15 / ADR-048: 本体を持たない POST に `Content-Type` を付けない。
    const { httpFetch, request } = requestWith(leaveHousehold, left);

    await request();

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(httpFetch.receivedRequests[0]?.body).toBeUndefined();
  });

  it('アクセストークンが取れなければ、失敗の結末を返す', async () => {
    // 規則15 / 7章 行1
    const { request } = requestWith(leaveHousehold, left, missingToken);

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンが取れなければ、要求を1つも出さない', async () => {
    // 規則15: `accessToken` が `null` なら要求を出さない（起きないことが要件。`docs/testing.md` 2章）。
    const { httpFetch, request } = requestWith(leaveHousehold, left, missingToken);

    await request();

    expect(httpFetch.receivedRequests).toEqual([]);
  });

  it('自分しか居ない断りも rule を運ばず、失敗の結末だけを返す', async () => {
    // 7章 行2 / ADR-087 決定6: 409 `leaveHousehold.alone` も `rule` を読まず `failed` に畳む。
    const { request } = requestWith(leaveHousehold, {
      ok: false,
      body: { rule: 'leaveHousehold.alone' },
    });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('出口が投げても、例外を外に出さず失敗の結末を返す', async () => {
    // 規則15 / FR-41
    const { request } = requestWith(leaveHousehold, { throws: new Error('到達できない') });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンの取り出しが投げても、例外を外に出さず失敗の結末を返す', async () => {
    // 規則15
    const { request } = requestWith(leaveHousehold, left, throwingToken);

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });
});

describe('世帯に参加する継ぎ目 joinHousehold', () => {
  /** 通った応答1つぶん（204 を写した本体なしの応答）。 */
  const joined: HttpDelivery = { ok: true, body: undefined };
  /** 招待が使えない断り（404）。 */
  const invalidInvitation: HttpDelivery = {
    ok: false,
    body: { rule: 'joinHousehold.invalidInvitation' },
  };

  it('応答が通れば、参加した結末を返す', async () => {
    // 規則7 / FR-45: 通った回は 204 で本体なしである。
    const { request } = requestWith(joinHousehold, joined);

    await expect(request('invite-token')).resolves.toEqual({ outcome: 'joined' });
  });

  it('通った応答の本体を読まないので、読めない本体でも参加した結末を返す', async () => {
    // 規則7: 2xx は本体を読まない（先行 `leaveHousehold`）。
    const { request } = requestWith(joinHousehold, { ok: true, unreadableBody: true });

    await expect(request('invite-token')).resolves.toEqual({ outcome: 'joined' });
  });

  it('基点に /household/join を足した先を POST で叩き、世帯を1つも載せない', async () => {
    // ADR-048 決定4 / C-9 / NFR-09: URL の完全一致で、足されたものが無いことまで見る。
    const { httpFetch, request } = requestWith(joinHousehold, joined);

    await request('invite-token');

    expect(httpFetch.receivedRequests[0]?.url).toBe(`${BASE_URL}/household/join`);
    expect(httpFetch.receivedRequests[0]?.method).toBe('POST');
  });

  it('渡されたトークンを JSON にして本体に載せる', async () => {
    // 規則7: 本体は `{ token }`（contract `AcceptHouseholdInvitationInput`）。期待値は literal で置く。
    const { httpFetch, request } = requestWith(joinHousehold, joined);

    await request('invite-token');

    expect(httpFetch.receivedRequests[0]?.body).toBe('{"token":"invite-token"}');
  });

  it('アクセストークンを Bearer で載せ、本体を持つので Content-Type に application/json を付ける', async () => {
    // 規則7 / ADR-048: 本体を持つ要求には `Content-Type` を付ける（先行 `registerStockItem`）。
    // 完全一致で、ほかのヘッダが無いことまで見る。
    const { httpFetch, request } = requestWith(joinHousehold, joined);

    await request('invite-token');

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    });
  });

  it('断りの rule をそのまま断られた結末に載せる', async () => {
    // 規則7 / ADR-032 決定3 / 7章 行1: 案内を選ぶのは画面の側なので、`rule` を読み替えない。
    const { request } = requestWith(joinHousehold, invalidInvitation);

    await expect(request('invite-token')).resolves.toEqual({
      outcome: 'rejected',
      rule: 'joinHousehold.invalidInvitation',
    });
  });

  it('断りの本体に rule が無ければ、失敗の結末を返す', async () => {
    // 規則7 / 7章 行4: `rule` の無い断り（5xx など）は失敗に畳む。
    const { request } = requestWith(joinHousehold, { ok: false, body: {} });

    await expect(request('invite-token')).resolves.toEqual({ outcome: 'failed' });
  });

  it('断りの本体が JSON として読めなければ、失敗の結末を返す', async () => {
    // 規則7 / 7章 行4: 本体なしの断りも失敗に畳む。
    const { request } = requestWith(joinHousehold, { ok: false, unreadableBody: true });

    await expect(request('invite-token')).resolves.toEqual({ outcome: 'failed' });
  });

  it('出口が投げても、例外を外に出さず失敗の結末を返す', async () => {
    // 規則7 / 7章 行4 / FR-41: 通信の失敗も失敗に畳み、外へ出さない。
    const { request } = requestWith(joinHousehold, { throws: new Error('到達できない') });

    await expect(request('invite-token')).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンが取れなければ、失敗の結末を返す', async () => {
    // 規則7 / 7章 行4
    const { request } = requestWith(joinHousehold, joined, missingToken);

    await expect(request('invite-token')).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンが取れなければ、要求を1つも出さない', async () => {
    // 規則7: `accessToken` が `null` なら要求を出さない（起きないことが要件。`docs/testing.md` 2章）。
    const { httpFetch, request } = requestWith(joinHousehold, joined, missingToken);

    await request('invite-token');

    expect(httpFetch.receivedRequests).toEqual([]);
  });

  it('1度断られても、自分では送り直さない', async () => {
    // 規則7: 呼ばれた1回で1往復だけする。送り直すかを決めるのは利用者である。
    const { httpFetch, request } = requestWith(joinHousehold, invalidInvitation);

    await request('invite-token');

    expect(httpFetch.receivedRequests).toHaveLength(1);
  });
});
