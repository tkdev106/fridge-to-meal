import { describe, expect, it } from 'vitest';
import { createHouseholdDataRoutes } from '../../../../src/contexts/meal/api/HouseholdDataRoutes.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { FixedIdentifyHousehold } from '../../../support/identity/FixedIdentifyHousehold.js';
import { FixedDeleteHouseholdData } from '../../../support/meal/FixedDeleteHouseholdData.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/**
 * アクセストークンは ASCII で置く。**ヘッダの値に非 ASCII を入れられない**
 * （`Headers` は値を ByteString に変換するため）。先行 `CookingRecordRoutes.test.ts` と同じ。
 */
const accessTokenA = 'access-token-a';

const householdDataPath = '/household-data';

/**
 * 世帯の特定と世帯のデータを消す口を代役で組み、経路を1つ作る。
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
  const deleteHouseholdData = new FixedDeleteHouseholdData(
    overrides.throws === undefined ? { succeeds: true } : { throws: overrides.throws },
  );

  const routes = createHouseholdDataRoutes({
    identifyHousehold: identifyHousehold.identify,
    deleteHouseholdData: deleteHouseholdData.delete,
  });

  return { routes, identifyHousehold, deleteHouseholdData };
}

/** 認証ヘッダ1つ。方式名と値の組み立てが本題のときだけ引数で上書きする。 */
function authorizationHeaders(value: string = `Bearer ${accessTokenA}`): Record<string, string> {
  return { Authorization: value };
}

/** 本体を持たない削除の要求。経路が本体を読まないことを確かめる既定の形である（規則9）。 */
function deleteRequest(headers = authorizationHeaders()) {
  return { method: 'DELETE', headers };
}

/** 本体を JSON で送る削除の要求。**経路がそれを読まないこと**を確かめるために使う。 */
function jsonDeleteRequest(body: unknown, headers = authorizationHeaders()) {
  return {
    method: 'DELETE',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * 本体を文字列のまま送る削除の要求。**JSON として読めない本体**を渡すときに使う
 * （`JSON.stringify` を通すと必ず読める本体になってしまう）。
 */
function rawBodyDeleteRequest(body: string, headers = authorizationHeaders()) {
  return {
    method: 'DELETE',
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
 * 実行環境の型を入れていないためである（先行 `CookingRecordRoutes.test.ts` と同じ）。
 */
async function responseBody(response: { text(): Promise<string> }): Promise<unknown> {
  return parseBody(await response.text());
}

/** deps の形。基準日時の口を取らないことを型として主張するために取り出す（規則9）。 */
type HouseholdDataRoutesDeps = Parameters<typeof createHouseholdDataRoutes>[0];

/**
 * deps のキーが2つだけなら `true`、1つでも他のキーがあれば `never`。
 * `never` になると下の代入が型検査で落ちる（先行 `MealListRoutes.test.ts`）。
 */
type DepsTakeNoClockPort = keyof HouseholdDataRoutesDeps extends
  'identifyHousehold' | 'deleteHouseholdData'
  ? true
  : never;

describe('世帯のデータの経路 HouseholdDataRoutes', () => {
  describe('経路の配置', () => {
    it('DELETE /household-data は世帯のデータを消して 204 を返す', async () => {
      // 規則10 / FR-27 / NFR-13: 接頭辞なしの DELETE。通った回の応答に中身を持たせない。
      const { routes, deleteHouseholdData } = setUp();

      const response = await routes.request(householdDataPath, deleteRequest());

      expect(response.status).toBe(204);
      expect(deleteHouseholdData.receivedHouseholdId).not.toBeNull();
    });

    it('204 の応答に本体を載せない', async () => {
      // 規則10 / ADR-062: 返す中身が無い（先行 `DELETE /stock-items/:id`）。
      const { routes } = setUp();

      const response = await routes.request(householdDataPath, deleteRequest());

      await expect(response.text()).resolves.toBe('');
    });

    it('GET /household-data では世帯のデータを消さない', async () => {
      // 規則9・10: 消す口は DELETE だけである。別の method に同じ口を生やさない。
      const { routes, deleteHouseholdData } = setUp();

      const response = await routes.request(householdDataPath, {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(404);
      expect(deleteHouseholdData.receivedHouseholdId).toBeNull();
    });
  });

  describe('ユースケースへの受け渡し', () => {
    it('認証で定まった世帯をユースケースに渡す', async () => {
      // C-9 / 規則9: 世帯はアクセストークンからだけ定まる。
      const { routes, deleteHouseholdData } = setUp();

      await routes.request(householdDataPath, deleteRequest());

      expect(deleteHouseholdData.receivedHouseholdId).toBe(ourHousehold);
    });

    it('クエリの householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / 規則9 / NFR-09: 世帯を利用者の入力から受け取らない。
      const { routes, deleteHouseholdData } = setUp();

      await routes.request(
        `${householdDataPath}?householdId=${neighborHousehold}`,
        deleteRequest(),
      );

      expect(deleteHouseholdData.receivedHouseholdId).toBe(ourHousehold);
    });

    it('本体の householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / 規則9 / NFR-09: 本体を1つも読まない。
      const { routes, deleteHouseholdData } = setUp();

      await routes.request(
        householdDataPath,
        jsonDeleteRequest({ householdId: neighborHousehold }),
      );

      expect(deleteHouseholdData.receivedHouseholdId).toBe(ourHousehold);
    });

    it('本体が JSON として読めなくても世帯のデータを消して 204 を返す', async () => {
      // 規則9: 本体を1つも読まないので、読めない本体に断りが無い。
      const { routes, deleteHouseholdData } = setUp();

      const response = await routes.request(householdDataPath, rawBodyDeleteRequest('{'));

      expect(response.status).toBe(204);
      expect(deleteHouseholdData.receivedHouseholdId).toBe(ourHousehold);
    });
  });

  describe('アクセストークンの取り出し', () => {
    it('Authorization の Bearer の後ろの値をアクセストークンとして渡す', async () => {
      // 規則11 / ADR-032: 取り出しは `api/AccessToken.ts` の共有のものである。
      const { routes, identifyHousehold } = setUp();

      await routes.request(householdDataPath, deleteRequest());

      expect(identifyHousehold.receivedAccessToken).toBe('access-token-a');
    });

    it('Authorization ヘッダが無い要求は 401 accessToken.missing を返す', async () => {
      // 7章1行目 / ADR-032: 判定は `IdentifyHousehold` に残り、api は空文字を渡す。
      const { routes } = setUp();

      const response = await routes.request(householdDataPath, { method: 'DELETE' });

      expect(response.status).toBe(401);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'accessToken.missing' });
    });

    it('検証を通らないアクセストークンには 401 と rule を返す', async () => {
      // 7章1行目 / ADR-032: `IdentityRuleViolation` の既定は 401 である。
      const { routes } = setUp({
        identifyHouseholdThrows: new IdentityRuleViolation(
          'accessToken.invalid',
          'アクセストークンが検証を通らない',
        ),
      });

      const response = await routes.request(householdDataPath, deleteRequest());

      expect(response.status).toBe(401);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'accessToken.invalid' });
    });

    it('認証を通らない要求では世帯のデータを消さない', async () => {
      // 規則11 / NFR-09: 世帯を定めるのが常に先。通らなければ DB に触れない。
      const { routes, deleteHouseholdData } = setUp({
        identifyHouseholdThrows: new IdentityRuleViolation(
          'accessToken.invalid',
          'アクセストークンが検証を通らない',
        ),
      });

      await routes.request(householdDataPath, deleteRequest());

      expect(deleteHouseholdData.receivedHouseholdId).toBeNull();
    });
  });

  describe('失敗の写像', () => {
    it('世帯の特定が規則違反でない失敗で落ちたら 500 unexpected を返し、401 にしない', async () => {
      // 7章2行目 / ADR-045: 鍵が引けない・設定が空はサーバ側の不備であり、利用者のせいにしない。
      const { routes } = setUp({ identifyHouseholdThrows: new Error('鍵を取りに行けなかった') });

      const response = await routes.request(householdDataPath, deleteRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('消す途中で規則違反でない失敗が起きたら 500 unexpected を返す', async () => {
      // 7章3行目 / ADR-045 決定3: DB の失敗は 500 の unexpected に畳む。
      const { routes } = setUp({ throws: new Error('接続が切れた') });

      const response = await routes.request(householdDataPath, deleteRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('500 の応答本体に例外の message を載せない', async () => {
      // NFR-09 / ADR-045 決定3: 接続文字列や設定の中身が応答に漏れる経路を作らない。
      const { routes } = setUp({ throws: new Error('setsuzoku-moji-retsu-himitsu') });

      const response = await routes.request(householdDataPath, deleteRequest());

      const text = await response.text();
      expect(parseBody(text)).toEqual({ rule: 'unexpected' });
      expect(text).not.toContain('setsuzoku-moji-retsu-himitsu');
    });

    it('表に無い献立の規則違反は 400 ではなく 500 を返す', async () => {
      // 7章 / ADR-062 決定3: 入力を受け取らない経路なので、起こるのはサーバ側の不備だけ。
      const { routes } = setUp({
        throws: new MealRuleViolation('dateTime.format', '日時の書式が違う'),
      });

      const response = await routes.request(householdDataPath, deleteRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'dateTime.format' });
    });
  });

  describe('依存の形', () => {
    it('経路の依存に基準日時の口を取らない', () => {
      // 規則9: 時刻に依存する判断が1つも無い。`now` を依存に足した時点で、この行が
      // typecheck で落ちる。実行時には何も確かめていない — 確かめているのは型検査のほうである。
      const assertion: DepsTakeNoClockPort = true;

      expect(assertion).toBe(true);
    });
  });
});
