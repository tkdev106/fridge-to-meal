import { describe, expect, it } from 'vitest';
import { createHouseholdRoutes } from '../../../../src/contexts/identity/api/HouseholdRoutes.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { FixedCountHouseholdMembers } from '../../../support/identity/FixedCountHouseholdMembers.js';
import { FixedIdentifyHousehold } from '../../../support/identity/FixedIdentifyHousehold.js';
import { FixedLeaveHousehold } from '../../../support/identity/FixedLeaveHousehold.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/**
 * アクセストークンは ASCII で置く。**ヘッダの値に非 ASCII を入れられない**
 * （`Headers` は値を ByteString に変換するため）。先行 `HouseholdDataRoutes.test.ts` と同じ。
 */
const accessTokenA = 'access-token-a';

const memberCountPath = '/household/member-count';
const leavePath = '/household/leave';

/**
 * 世帯の特定・人数・抜ける口を代役で組み、経路を1つ作る。
 * テストの本題でない結線をここに隠す（`docs/testing.md` 6章）。
 *
 * 失敗の写像を見るときは `〜Throws` を渡す。**投げる例外と成功の応答は同時に渡せない** —
 * 代役の応答がどちらか一方であるため。
 */
function setUp(
  overrides: {
    identifyHouseholdThrows?: Error;
    countThrows?: Error;
    leaveThrows?: Error;
  } = {},
) {
  const identifyHousehold = new FixedIdentifyHousehold(
    overrides.identifyHouseholdThrows === undefined
      ? { returns: ourHousehold }
      : { throws: overrides.identifyHouseholdThrows },
  );
  const countHouseholdMembers = new FixedCountHouseholdMembers(
    overrides.countThrows === undefined ? { returns: 2 } : { throws: overrides.countThrows },
  );
  const leaveHousehold = new FixedLeaveHousehold(
    overrides.leaveThrows === undefined ? { succeeds: true } : { throws: overrides.leaveThrows },
  );

  const routes = createHouseholdRoutes({
    identifyHousehold: identifyHousehold.identify,
    countHouseholdMembers: countHouseholdMembers.count,
    leaveHousehold: leaveHousehold.leave,
  });

  return { routes, identifyHousehold, countHouseholdMembers, leaveHousehold };
}

/** 認証ヘッダ1つ。方式名と値の組み立てが本題のときだけ引数で上書きする。 */
function authorizationHeaders(value: string = `Bearer ${accessTokenA}`): Record<string, string> {
  return { Authorization: value };
}

/** 人数の要求。本体を持たない。 */
function memberCountRequest(headers = authorizationHeaders()) {
  return { headers };
}

/** 本体を持たない抜ける要求。経路が本体を読まないことを確かめる既定の形である（規則9）。 */
function leaveRequest(headers = authorizationHeaders()) {
  return { method: 'POST', headers };
}

/** 本体を JSON で送る抜ける要求。**経路がそれを読まないこと**を確かめるために使う。 */
function jsonLeaveRequest(body: unknown, headers = authorizationHeaders()) {
  return {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * JSON として読めればその値、**読めなければ読めた文字列そのもの**を返す。構文エラーで
 * 落とすと、`{ rule }` の代わりに何が返ったのかが読めなくなるため。
 */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * 応答本体を読む。引数の型を `Response` と書かないのは、このテストのプロジェクトが
 * 実行環境の型を入れていないためである（先行 `HouseholdDataRoutes.test.ts` と同じ）。
 */
async function responseBody(response: { text(): Promise<string> }): Promise<unknown> {
  return parseBody(await response.text());
}

/** 抜ける口が「自分しか居ない」で断るときの例外（設計書 規則6）。 */
function aloneViolation(): IdentityRuleViolation {
  return new IdentityRuleViolation('leaveHousehold.alone', '自分しか居ない世帯からは抜けられない');
}

/** 検証を通らないアクセストークンの断り。 */
function invalidAccessTokenViolation(): IdentityRuleViolation {
  return new IdentityRuleViolation('accessToken.invalid', 'アクセストークンが検証を通らない');
}

describe('世帯の経路 HouseholdRoutes', () => {
  describe('人数の経路 GET /household/member-count', () => {
    it('GET /household/member-count は 200 と人数を返す', async () => {
      // 設計書 規則9 / FR-47: 本体は `HouseholdMemberCountOutput`。
      const { routes } = setUp();

      const response = await routes.request(memberCountPath, memberCountRequest());

      expect(response.status).toBe(200);
      await expect(responseBody(response)).resolves.toEqual({ memberCount: 2 });
    });

    it('人数の経路は認証で定まった世帯をユースケースに渡す', async () => {
      // C-9 / 設計書 規則9: 世帯はアクセストークンからだけ定まる。
      const { routes, countHouseholdMembers } = setUp();

      await routes.request(memberCountPath, memberCountRequest());

      expect(countHouseholdMembers.receivedHouseholdId).toBe(ourHousehold);
    });

    it('人数の経路はクエリの householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / 設計書 規則9 / NFR-09: 世帯を利用者の入力から受け取らない。
      const { routes, countHouseholdMembers } = setUp();

      await routes.request(
        `${memberCountPath}?householdId=${neighborHousehold}`,
        memberCountRequest(),
      );

      expect(countHouseholdMembers.receivedHouseholdId).toBe(ourHousehold);
    });
  });

  describe('抜ける経路 POST /household/leave', () => {
    it('POST /household/leave は抜けて 204 を返す', async () => {
      // 設計書 規則9 / FR-46: 通った回の応答に中身を持たせない。
      const { routes, leaveHousehold } = setUp();

      const response = await routes.request(leavePath, leaveRequest());

      expect(response.status).toBe(204);
      expect(leaveHousehold.receivedHouseholdId).not.toBeNull();
    });

    it('抜ける経路の 204 の応答に本体を載せない', async () => {
      // 設計書 規則9: 返す中身が無い（先行 `DELETE /household-data`）。
      const { routes } = setUp();

      const response = await routes.request(leavePath, leaveRequest());

      await expect(response.text()).resolves.toBe('');
    });

    it('抜ける経路は本体の householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / 設計書 規則9 / NFR-09: 本体を1つも読まない。
      const { routes, leaveHousehold } = setUp();

      await routes.request(leavePath, jsonLeaveRequest({ householdId: neighborHousehold }));

      expect(leaveHousehold.receivedHouseholdId).toBe(ourHousehold);
    });

    it('自分しか居ない世帯で抜けようとすると 409 leaveHousehold.alone を返す', async () => {
      // 設計書 7章1行目 / FR-46 / ADR-087 決定6: 認証の断り（401）と区別する。
      const { routes } = setUp({ leaveThrows: aloneViolation() });

      const response = await routes.request(leavePath, leaveRequest());

      expect(response.status).toBe(409);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'leaveHousehold.alone' });
    });
  });

  describe('アクセストークンの取り出し', () => {
    it('Authorization の Bearer の後ろの値をアクセストークンとして渡す', async () => {
      // 設計書 4章 / ADR-032: 取り出しは identity の `api/AccessToken.ts`（写し）である。
      const { routes, identifyHousehold } = setUp();

      await routes.request(leavePath, leaveRequest());

      expect(identifyHousehold.receivedAccessToken).toBe('access-token-a');
    });

    it('Authorization ヘッダが無い人数の要求は 401 accessToken.missing を返す', async () => {
      // 設計書 7章2行目 / ADR-032: 判定は `IdentifyHousehold` に残り、api は空文字を渡す。
      const { routes } = setUp();

      const response = await routes.request(memberCountPath, {});

      expect(response.status).toBe(401);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'accessToken.missing' });
    });

    it('検証を通らないアクセストークンで抜けようとすると 401 と rule を返す', async () => {
      // 設計書 7章2行目 / ADR-032: `IdentityRuleViolation` の既定は 401 である。
      const { routes } = setUp({ identifyHouseholdThrows: invalidAccessTokenViolation() });

      const response = await routes.request(leavePath, leaveRequest());

      expect(response.status).toBe(401);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'accessToken.invalid' });
    });

    it('認証を通らない要求では世帯を抜けない', async () => {
      // 設計書 規則9 / NFR-09: 世帯を定めるのが常に先。通らなければ DB に触れない。
      const { routes, leaveHousehold } = setUp({
        identifyHouseholdThrows: invalidAccessTokenViolation(),
      });

      await routes.request(leavePath, leaveRequest());

      expect(leaveHousehold.receivedHouseholdId).toBeNull();
    });

    it('認証を通らない要求では人数を数えない', async () => {
      // 設計書 規則9 / NFR-09。
      const { routes, countHouseholdMembers } = setUp({
        identifyHouseholdThrows: invalidAccessTokenViolation(),
      });

      await routes.request(memberCountPath, memberCountRequest());

      expect(countHouseholdMembers.receivedHouseholdId).toBeNull();
    });
  });

  describe('失敗の写像', () => {
    it('世帯の特定が規則違反でない失敗で落ちたら 500 unexpected を返し、401 にしない', async () => {
      // 設計書 7章3行目 / ADR-045: 鍵が引けない・設定が空はサーバ側の不備であり、利用者のせいにしない。
      const { routes } = setUp({ identifyHouseholdThrows: new Error('鍵を取りに行けなかった') });

      const response = await routes.request(leavePath, leaveRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('抜ける途中で規則違反でない失敗が起きたら 500 unexpected を返し、409 にしない', async () => {
      // 設計書 7章3行目 / ADR-045 決定3: 関数が無い・権限が無いは 500 の unexpected に畳む。
      const { routes } = setUp({ leaveThrows: new Error('関数が無かった') });

      const response = await routes.request(leavePath, leaveRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('人数を数える途中で規則違反でない失敗が起きたら 500 unexpected を返す', async () => {
      // 設計書 7章3行目 / ADR-045 決定3。
      const { routes } = setUp({ countThrows: new Error('接続が切れた') });

      const response = await routes.request(memberCountPath, memberCountRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('500 の応答本体に例外の message を載せない', async () => {
      // NFR-09 / ADR-045 決定3: 接続文字列や設定の中身が応答に漏れる経路を作らない。
      const { routes } = setUp({ leaveThrows: new Error('setsuzoku-moji-retsu-himitsu') });

      const response = await routes.request(leavePath, leaveRequest());

      const text = await response.text();
      expect(parseBody(text)).toEqual({ rule: 'unexpected' });
      expect(text).not.toContain('setsuzoku-moji-retsu-himitsu');
    });
  });
});
