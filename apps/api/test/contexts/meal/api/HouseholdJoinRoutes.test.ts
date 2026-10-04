import { describe, expect, it } from 'vitest';
import { createHouseholdJoinRoutes } from '../../../../src/contexts/meal/api/HouseholdJoinRoutes.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { FixedIdentifyHousehold } from '../../../support/identity/FixedIdentifyHousehold.js';
import { FixedAcceptHouseholdInvitation } from '../../../support/meal/FixedAcceptHouseholdInvitation.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/**
 * アクセストークンは ASCII で置く。**ヘッダの値に非 ASCII を入れられない**
 * （`Headers` は値を ByteString に変換するため）。先行 `HouseholdDataRoutes.test.ts` と同じ。
 */
const accessTokenA = 'access-token-a';

const joinPath = '/household/join';

/** 本体で送る招待のトークン。 */
const invitation = 'invitation-from-link';

/**
 * 世帯の特定と招待で参加する口を代役で組み、経路を1つ作る。
 * テストの本題でない結線をここに隠す（`docs/testing.md` 6章）。
 *
 * 失敗の写像を見るときは `〜Throws` を渡す。**投げる例外と成功の印は同時に渡せない** —
 * 代役の応答がどちらか一方であるため。
 */
function setUp(overrides: { throws?: Error; identifyHouseholdThrows?: Error } = {}) {
  const identifyHousehold = new FixedIdentifyHousehold(
    overrides.identifyHouseholdThrows === undefined
      ? { returns: ourHousehold }
      : { throws: overrides.identifyHouseholdThrows },
  );
  const acceptHouseholdInvitation = new FixedAcceptHouseholdInvitation(
    overrides.throws === undefined ? { succeeds: true } : { throws: overrides.throws },
  );

  const routes = createHouseholdJoinRoutes({
    identifyHousehold: identifyHousehold.identify,
    acceptHouseholdInvitation: acceptHouseholdInvitation.accept,
  });

  return { routes, identifyHousehold, acceptHouseholdInvitation };
}

/** 認証ヘッダ1つ。 */
function authorizationHeaders(value: string = `Bearer ${accessTokenA}`): Record<string, string> {
  return { Authorization: value };
}

/** 本体を JSON で送る参加の要求。既定の本体は使える形の `{ token }` である。 */
function joinRequest(body: unknown = { token: invitation }, headers = authorizationHeaders()) {
  return {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * 本体を文字列のまま送る参加の要求。**JSON として読めない本体**を渡すときに使う
 * （`JSON.stringify` を通すと必ず読める本体になってしまう）。
 */
function rawBodyJoinRequest(body: string, headers = authorizationHeaders()) {
  return {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body,
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

/** 検証を通らないアクセストークンの断り。 */
function invalidAccessTokenViolation(): IdentityRuleViolation {
  return new IdentityRuleViolation('accessToken.invalid', 'アクセストークンが検証を通らない');
}

describe('招待で参加する経路 HouseholdJoinRoutes', () => {
  describe('経路の配置', () => {
    it('POST /household/join は参加して 204 を返す', async () => {
      // B-74 設計書 規則15 / FR-45: 接頭辞なしの POST。
      const { routes } = setUp();

      const response = await routes.request(joinPath, joinRequest());

      expect(response.status).toBe(204);
    });

    it('参加の 204 の応答に本体を載せない', async () => {
      // B-74 設計書 規則15: 返す中身が無い（先行 `POST /household/leave`）。
      const { routes } = setUp();

      const response = await routes.request(joinPath, joinRequest());

      await expect(response.text()).resolves.toBe('');
    });
  });

  describe('ユースケースへの受け渡し', () => {
    it('本体の token をそのままユースケースに渡す', async () => {
      // B-74 設計書 規則15 / FR-45: 本体は `AcceptHouseholdInvitationInput`。
      const { routes, acceptHouseholdInvitation } = setUp();

      await routes.request(joinPath, joinRequest({ token: invitation }));

      expect(acceptHouseholdInvitation.receivedToken).toBe('invitation-from-link');
    });

    it('認証で定まった世帯をユースケースに渡す', async () => {
      // C-9 / B-74 設計書 規則13: 世帯はアクセストークンからだけ定まる。
      const { routes, acceptHouseholdInvitation } = setUp();

      await routes.request(joinPath, joinRequest());

      expect(acceptHouseholdInvitation.receivedHouseholdId).toBe(ourHousehold);
    });

    it('本体の householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / B-74 設計書 規則13 / NFR-09: 世帯を本体から読まない。
      const { routes, acceptHouseholdInvitation } = setUp();

      await routes.request(
        joinPath,
        joinRequest({ token: invitation, householdId: neighborHousehold }),
      );

      expect(acceptHouseholdInvitation.receivedHouseholdId).toBe(ourHousehold);
    });

    it('token が空文字でも形として通し、空文字のまま渡して 204 を返す', async () => {
      // B-74 設計書 規則15・規則4: 空や空白は DB で invalid_invitation に畳む。api は中身を見ない。
      const { routes, acceptHouseholdInvitation } = setUp();

      const response = await routes.request(joinPath, joinRequest({ token: '' }));

      expect({ status: response.status, token: acceptHouseholdInvitation.receivedToken }).toEqual({
        status: 204,
        token: '',
      });
    });

    it('知らない項目は無視して 204 を返す', async () => {
      // B-74 設計書 規則15: 知らない項目で断らない（先行 `StockItemRoutes`）。
      const { routes } = setUp();

      const response = await routes.request(
        joinPath,
        joinRequest({ token: invitation, note: '知らない項目' }),
      );

      expect(response.status).toBe(204);
    });
  });

  describe('本体の形', () => {
    it('本体が JSON として読めなければ 400 request.notJson を返す', async () => {
      // B-74 設計書 規則15・7章2行目: 先行 `StockItemRoutes` の `readBody`。
      const { routes } = setUp();

      const response = await routes.request(joinPath, rawBodyJoinRequest('{'));

      expect(response.status).toBe(400);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'request.notJson' });
    });

    it('本体が null なら 400 request.invalidBody を返す', async () => {
      // B-74 設計書 規則15・7章3行目: オブジェクトでない本体は形が違う。
      const { routes } = setUp();

      const response = await routes.request(joinPath, joinRequest(null));

      expect(response.status).toBe(400);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'request.invalidBody' });
    });

    it('token が文字列でなければ 400 request.invalidBody を返す', async () => {
      // B-74 設計書 規則15・7章3行目。
      const { routes } = setUp();

      const response = await routes.request(joinPath, joinRequest({ token: 42 }));

      expect(response.status).toBe(400);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'request.invalidBody' });
    });

    it('token が無ければ 400 request.invalidBody を返す', async () => {
      // B-74 設計書 規則15・7章3行目。
      const { routes } = setUp();

      const response = await routes.request(joinPath, joinRequest({}));

      expect(response.status).toBe(400);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'request.invalidBody' });
    });
  });

  describe('参加の断り', () => {
    it('使えない招待なら 404 joinHousehold.invalidInvitation を返す', async () => {
      // B-74 設計書 7章4行目 / ADR-087 決定4: 無い・切れた・使用済みを区別しない。
      const { routes } = setUp({
        throws: new IdentityRuleViolation('joinHousehold.invalidInvitation', '使えない招待である'),
      });

      const response = await routes.request(joinPath, joinRequest());

      expect(response.status).toBe(404);
      await expect(responseBody(response)).resolves.toEqual({
        rule: 'joinHousehold.invalidInvitation',
      });
    });

    it('既に招待の世帯に居れば 409 joinHousehold.alreadyMember を返す', async () => {
      // B-74 設計書 7章5行目 / ADR-087 決定5: 状態の衝突は 409（先行 `leaveHousehold.alone`）。
      const { routes } = setUp({
        throws: new IdentityRuleViolation('joinHousehold.alreadyMember', '既に居る世帯である'),
      });

      const response = await routes.request(joinPath, joinRequest());

      expect(response.status).toBe(409);
      await expect(responseBody(response)).resolves.toEqual({
        rule: 'joinHousehold.alreadyMember',
      });
    });
  });

  describe('認証', () => {
    it('認証を通らない要求は、本体が JSON でなくても 401 と rule を返す', async () => {
      // B-74 設計書 規則16・7章1行目: 本体の形を見るのは認証のあとである。
      const { routes } = setUp({ identifyHouseholdThrows: invalidAccessTokenViolation() });

      const response = await routes.request(joinPath, rawBodyJoinRequest('{'));

      expect(response.status).toBe(401);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'accessToken.invalid' });
    });

    it('認証を通らない要求では参加しない', async () => {
      // B-74 設計書 規則13 / NFR-09: 世帯を定めるのが常に先。通らなければ DB に触れない。
      const { routes, acceptHouseholdInvitation } = setUp({
        identifyHouseholdThrows: invalidAccessTokenViolation(),
      });

      await routes.request(joinPath, joinRequest());

      expect(acceptHouseholdInvitation.receivedHouseholdId).toBeNull();
    });
  });

  describe('失敗の写像', () => {
    it('参加の途中で規則違反でない失敗が起きたら 500 unexpected を返す', async () => {
      // B-74 設計書 7章6行目 / ADR-045 決定3: 関数が無い・権限が無いは 500 の unexpected に畳む。
      const { routes } = setUp({ throws: new Error('関数が無かった') });

      const response = await routes.request(joinPath, joinRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });
  });
});
