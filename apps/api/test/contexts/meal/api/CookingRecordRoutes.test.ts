import { describe, expect, it } from 'vitest';
import { createCookingRecordRoutes } from '../../../../src/contexts/meal/api/CookingRecordRoutes.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { FixedIdentifyHousehold } from '../../../support/identity/FixedIdentifyHousehold.js';
import { FixedAddCookingRecord } from '../../../support/meal/FixedAddCookingRecord.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

const idA = mealIdOf('22222222-2222-4222-8222-222222222222');

/**
 * アクセストークンは ASCII で置く。**ヘッダの値に非 ASCII を入れられない**
 * （`Headers` は値を ByteString に変換するため）。先行 `IngredientNameRoutes.test.ts` と同じ。
 */
const accessTokenA = 'access-token-a';

/** 代役の `now` が返す固定の日時（`docs/testing.md` 5章）。テストは時計を読まない。 */
const fixedNow = '2026-09-24T12:00:00.000Z';

/**
 * 世帯の特定と調理記録の口を代役で組み、経路を1つ作る。
 * テストの本題でない結線をここに隠す（`docs/testing.md` 6章）。
 *
 * 失敗の写像を見るときは `〜Throws` を渡す。**投げる例外と成功の印は同時に渡せない** —
 * 代役の応答がどちらか一方であるため。
 */
function setUp(
  overrides: {
    throws?: Error;
    identifyHouseholdThrows?: Error;
    now?: () => string;
  } = {},
) {
  const identifyHousehold = new FixedIdentifyHousehold(
    overrides.identifyHouseholdThrows === undefined
      ? { returns: ourHousehold }
      : { throws: overrides.identifyHouseholdThrows },
  );
  const addCookingRecord = new FixedAddCookingRecord(
    overrides.throws === undefined ? { succeeds: true } : { throws: overrides.throws },
  );

  const routes = createCookingRecordRoutes({
    identifyHousehold: identifyHousehold.identify,
    addCookingRecord: addCookingRecord.add,
    now: overrides.now ?? (() => fixedNow),
  });

  return { routes, identifyHousehold, addCookingRecord };
}

/** 経路1本ぶんの道。識別子を上書きするのはそれが本題のときだけである。 */
function cookingRecordsPath(id: string = idA): string {
  return `/meals/${id}/cooking-records`;
}

/** 認証ヘッダ1つ。方式名と値の組み立てが本題のときだけ引数で上書きする。 */
function authorizationHeaders(value: string = `Bearer ${accessTokenA}`): Record<string, string> {
  return { Authorization: value };
}

/** 本体を持たない要求。調理記録の経路が読まないことを確かめる既定の形である（規則11）。 */
function postRequest(headers = authorizationHeaders()) {
  return { method: 'POST', headers };
}

/** 本体を JSON で送る要求。**経路がそれを読まないこと**を確かめるために使う。 */
function jsonRequest(body: unknown, headers = authorizationHeaders()) {
  return {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * 本体を文字列のまま送る要求。**JSON として読めない本体**を渡すときに使う
 * （`JSON.stringify` を通すと必ず読める本体になってしまう）。
 */
function rawBodyRequest(body: string, headers = authorizationHeaders()) {
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
 * 実行環境の型を入れていないためである（先行 `IngredientNameRoutes.test.ts` と同じ）。
 */
async function responseBody(response: { text(): Promise<string> }): Promise<unknown> {
  return parseBody(await response.text());
}

/** deps の形。在庫の口を1つも取らないことを型として主張するために取り出す（C-8 / 規則9）。 */
type CookingRecordRoutesDeps = Parameters<typeof createCookingRecordRoutes>[0];

/**
 * deps のキーが3つだけなら `true`、1つでも他のキーがあれば `never`。
 * `never` になると下の代入が型検査で落ちる。
 */
type DepsTakeNoStockItemPort = keyof CookingRecordRoutesDeps extends
  'identifyHousehold' | 'addCookingRecord' | 'now'
  ? true
  : never;

describe('調理記録の経路 CookingRecordRoutes', () => {
  describe('経路の配置', () => {
    it('POST /meals/:id/cooking-records は記録を足して 204 を返す', async () => {
      // 規則10 / FR-22: 接頭辞なしの POST。通った回の応答に中身を持たせない。
      const { routes, addCookingRecord } = setUp();

      const response = await routes.request(cookingRecordsPath(), postRequest());

      expect(response.status).toBe(204);
      expect(addCookingRecord.callCount).toBe(1);
    });

    it('204 の応答に本体を載せない', async () => {
      // 規則10 / NFR-09: 調理記録は contract のどの型にも載せず、返す中身が無い。
      const { routes } = setUp();

      const response = await routes.request(cookingRecordsPath(), postRequest());

      await expect(response.text()).resolves.toBe('');
    });

    it('GET /meals/:id/cooking-records では記録を足さない', async () => {
      // 規則10・11: 記録を足す口は POST だけである。別の method に同じ口を生やさない。
      const { routes, addCookingRecord } = setUp();

      await routes.request(cookingRecordsPath(), { headers: authorizationHeaders() });

      expect(addCookingRecord.callCount).toBe(0);
    });
  });

  describe('ユースケースへの受け渡し', () => {
    it('認証で定まった世帯をユースケースの第1引数に渡す', async () => {
      // C-9 / 規則1: 世帯はアクセストークンから定まり、必ず第1引数で渡る。
      const { routes, addCookingRecord } = setUp();

      await routes.request(cookingRecordsPath(), postRequest());

      expect(addCookingRecord.receivedHouseholdId).toBe(ourHousehold);
    });

    it('経路の識別子を加工せずに第2引数に渡す', async () => {
      // 規則11 / ADR-026 / ADR-032 結果1: 書式も長さも見ない。空白も落とさない。
      const { routes, addCookingRecord } = setUp();

      await routes.request(cookingRecordsPath('%20m-1%20'), postRequest());

      expect(addCookingRecord.receivedMealId).toBe(mealIdOf(' m-1 '));
    });

    it('記録の日時は deps の now の値を第3引数に渡す', async () => {
      // 規則4 / B-48b 規則4: 時計を読むのは結線の側であり、経路も本体も読まない。
      const { routes, addCookingRecord } = setUp({ now: () => '2026-09-24T12:00:00.000Z' });

      await routes.request(cookingRecordsPath(), postRequest());

      expect(addCookingRecord.receivedCookedAt).toBe('2026-09-24T12:00:00.000Z');
    });

    it('続けて2度要求すると、2度目には2度目の now の値が届く', async () => {
      // 規則4 / ADR-062 決定1: 基準日時は要求ごとに読む。組み立て時に1度読んで固定しない。
      const values = ['2026-09-24T12:00:00.000Z', '2026-09-25T18:30:00.000Z'];
      let readCount = 0;
      const { routes, addCookingRecord } = setUp({
        now: () => values[readCount++] ?? '用意した日時が尽きた',
      });

      await routes.request(cookingRecordsPath(), postRequest());
      await routes.request(cookingRecordsPath(), postRequest());

      expect(addCookingRecord.receivedCookedAt).toBe('2026-09-25T18:30:00.000Z');
    });

    it('要求本体の cookedAt を見ず、now の値を日時として渡す', async () => {
      // 規則11 / NFR-09: 記録の日時を利用者の入力から受け取らない。
      const { routes, addCookingRecord } = setUp();

      await routes.request(cookingRecordsPath(), jsonRequest({ cookedAt: '1999-01-01T00:00:00Z' }));

      expect(addCookingRecord.receivedCookedAt).toBe('2026-09-24T12:00:00.000Z');
    });

    it('本体が JSON として読めなくても記録を足して 204 を返す', async () => {
      // 規則11 / 7章 最終行: 本体を1つも読まないので、読めない本体に断りが無い。
      const { routes, addCookingRecord } = setUp();

      const response = await routes.request(cookingRecordsPath(), rawBodyRequest('{'));

      expect(response.status).toBe(204);
      expect(addCookingRecord.callCount).toBe(1);
    });

    it('クエリの householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // C-9 / 規則11 / ADR-087 決定2: 世帯を利用者の入力から受け取らない。
      const { routes, addCookingRecord } = setUp();

      await routes.request(
        `${cookingRecordsPath()}?householdId=${neighborHousehold}`,
        postRequest(),
      );

      expect(addCookingRecord.receivedHouseholdId).toBe(ourHousehold);
    });

    it('認証を通らない要求は記録を足さない', async () => {
      // 規則1 / NFR-09: 世帯を定めるのが常に先。通らなければ DB に触れない。
      const { routes, addCookingRecord } = setUp({
        identifyHouseholdThrows: new IdentityRuleViolation(
          'accessToken.invalid',
          'アクセストークンが検証を通らない',
        ),
      });

      await routes.request(cookingRecordsPath(), postRequest());

      expect(addCookingRecord.callCount).toBe(0);
    });
  });

  describe('アクセストークンの取り出し', () => {
    it('Authorization の Bearer の後ろの値をアクセストークンとして渡す', async () => {
      // 規則1 / ADR-032: 取り出しは `api/AccessToken.ts` の共有のものである。
      const { routes, identifyHousehold } = setUp();

      await routes.request(cookingRecordsPath(), postRequest());

      expect(identifyHousehold.receivedAccessToken).toBe('access-token-a');
    });

    it('Authorization ヘッダが無い要求は 401 を返す', async () => {
      // 規則1 / ADR-032: 判定は `IdentifyHousehold` に残り、api は空文字を渡す。
      const { routes } = setUp();

      const response = await routes.request(cookingRecordsPath(), { method: 'POST' });

      expect(response.status).toBe(401);
    });
  });

  describe('失敗の写像', () => {
    it('指した献立がその世帯に無いときは 404 を返し rule を載せる', async () => {
      // 7章 / C-9 / ADR-062 決定3: 他世帯を指した回も同じ断りである。
      const { routes } = setUp({
        throws: new MealRuleViolation(
          'addCookingRecord.mealNotFound',
          '指定された献立が見つかりません',
        ),
      });

      const response = await routes.request(cookingRecordsPath(), postRequest());

      expect(response.status).toBe(404);
      await expect(responseBody(response)).resolves.toEqual({
        rule: 'addCookingRecord.mealNotFound',
      });
    });

    it('見つからない記録の応答本体に指した識別子も世帯も載せない', async () => {
      // 規則3 / C-9 / NFR-09: `message` に入っていても応答には出さない。
      const { routes } = setUp({
        throws: new MealRuleViolation(
          'addCookingRecord.mealNotFound',
          `世帯 ${ourHousehold} の献立 ${idA} が見つからない`,
        ),
      });

      const response = await routes.request(cookingRecordsPath(), postRequest());

      const text = await response.text();
      expect(Object.keys(parseBody(text) as Record<string, unknown>)).toEqual(['rule']);
      expect(text).not.toContain(idA);
      expect(text).not.toContain(ourHousehold);
    });

    it('保存が読み比べで断ったときは 500 を返し rule を載せる', async () => {
      // 7章 / ADR-057: 呼び出し側の誤りであり、利用者の入力ではない。
      const { routes } = setUp({
        throws: new MealRuleViolation('save.contentMismatch', '保存済みの中身と食い違う'),
      });

      const response = await routes.request(cookingRecordsPath(), postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'save.contentMismatch' });
    });

    it('表に無い献立の規則違反は 400 ではなく 500 を返す', async () => {
      // 7章3行目 / ADR-062 決定3: 日時は要求から受け取らないので、起こるのはサーバ側の不備だけ。
      const { routes } = setUp({
        throws: new MealRuleViolation('dateTime.format', '日時の書式が違う'),
      });

      const response = await routes.request(cookingRecordsPath(), postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'dateTime.format' });
    });

    it('規則違反でない失敗が起きたら 500 の unexpected を返す', async () => {
      // 7章 / ADR-045 決定3: 写せない失敗は 500 の unexpected に畳む。
      const { routes } = setUp({ throws: new Error('接続が切れた') });

      const response = await routes.request(cookingRecordsPath(), postRequest());

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('500 の応答本体に例外の message を載せない', async () => {
      // NFR-09 / ADR-045 決定3: 接続文字列や設定の中身が応答に漏れる経路を作らない。
      const { routes } = setUp({ throws: new Error('setsuzoku-moji-retsu-himitsu') });

      const response = await routes.request(cookingRecordsPath(), postRequest());

      const text = await response.text();
      expect(parseBody(text)).toEqual({ rule: 'unexpected' });
      expect(text).not.toContain('setsuzoku-moji-retsu-himitsu');
    });
  });

  describe('依存の形', () => {
    it('経路の依存に在庫の口を1つも取らない', () => {
      // C-8 / 規則9: 「作った」を記録しても在庫は減らさない。在庫の口を依存に足した
      // 時点で、この行が typecheck で落ちる。実行時には何も確かめていない —
      // 確かめているのは型検査のほうである（先行 `AddCookingRecord.test.ts` の C-8 の行）。
      const assertion: DepsTakeNoStockItemPort = true;

      expect(assertion).toBe(true);
    });
  });
});
