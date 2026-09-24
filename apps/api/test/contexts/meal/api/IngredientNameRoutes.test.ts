import type { ListIngredientNamesOutput } from '@fridge-to-meal/contract';
import { describe, expect, it } from 'vitest';
import { createIngredientNameRoutes } from '../../../../src/contexts/meal/api/IngredientNameRoutes.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { PantryRuleViolation } from '../../../../src/contexts/pantry/domain/error/PantryRuleViolation.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { FixedIdentifyHousehold } from '../../../support/identity/FixedIdentifyHousehold.js';
import { FixedListIngredientNames } from '../../../support/meal/FixedListIngredientNames.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/**
 * アクセストークンは ASCII で置く。**ヘッダの値に非 ASCII を入れられない**
 * （`Headers` は値を ByteString に変換するため）。先行 `SuggestionRoutes.test.ts` と同じ。
 */
const accessTokenA = 'access-token-a';

/**
 * 代役が返す食材名の列。**名称順でない2件**を並べる（B-50b 規則6）— 経路が並べ替えないことを
 * 並びとして観察するためである。並べるのはユースケースの仕事（ADR-063 決定4）。
 */
const ingredientNamesOutput: ListIngredientNamesOutput = {
  ingredientNames: ['にんじん', 'たまねぎ'],
};

/**
 * 世帯の特定と食材名の口を代役で組み、経路を1つ作る。
 * テストの本題でない結線をここに隠す（`docs/testing.md` 6章）。
 *
 * 失敗の写像を見るときは `〜Throws` を渡す。**投げる例外と返す値は同時に渡せない** —
 * 代役の応答がどちらか一方であるため。
 */
function setUp(
  overrides: {
    output?: ListIngredientNamesOutput;
    throws?: Error;
    identifyHouseholdThrows?: Error;
  } = {},
) {
  const identifyHousehold = new FixedIdentifyHousehold(
    overrides.identifyHouseholdThrows === undefined
      ? { returns: ourHousehold }
      : { throws: overrides.identifyHouseholdThrows },
  );
  const listIngredientNames = new FixedListIngredientNames(
    overrides.throws === undefined
      ? { returns: overrides.output ?? ingredientNamesOutput }
      : { throws: overrides.throws },
  );

  const routes = createIngredientNameRoutes({
    identifyHousehold: identifyHousehold.identify,
    listIngredientNames: listIngredientNames.list,
  });

  return { routes, identifyHousehold, listIngredientNames };
}

/** 認証ヘッダ1つ。方式名と値の組み立てが本題のときだけ引数で上書きする。 */
function authorizationHeaders(value: string = `Bearer ${accessTokenA}`): Record<string, string> {
  return { Authorization: value };
}

/** JSON として読めればその値、読めなければ読めた文字列そのものを返す。 */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * 応答本体を読む。引数の型を `Response` と書かないのは、このテストのプロジェクトが
 * 実行環境の型を入れていないためである（先行 `SuggestionRoutes.test.ts` と同じ）。
 */
async function responseBody(response: { text(): Promise<string> }): Promise<unknown> {
  return parseBody(await response.text());
}

/** 規則違反に似せた別の例外。`name` が違うものを規則違反として扱わないことを確かめる（ADR-032）。 */
function ruleViolationLike(rule: string, message: string): Error {
  const error = new Error(message);
  error.name = 'OtherRuleViolation';
  return Object.assign(error, { rule });
}

describe('食材名の経路 IngredientNameRoutes', () => {
  describe('経路の配置', () => {
    it('GET /ingredient-names は食材名を求めて 200 を返す', async () => {
      // 規則1・2 / FR-02 / ADR-048 決定4 / ADR-065 決定2: 接頭辞なしの GET。
      const { routes, listIngredientNames } = setUp();

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(200);
      expect(listIngredientNames.callCount).toBe(1);
    });

    it('POST /ingredient-names では食材名を求めない', async () => {
      // 規則2: 読み取りの経路は GET だけである。別の method に同じ口を生やさない。
      const { routes, listIngredientNames } = setUp();

      await routes.request('/ingredient-names', {
        method: 'POST',
        headers: authorizationHeaders(),
      });

      expect(listIngredientNames.callCount).toBe(0);
    });
  });

  describe('世帯の受け渡し', () => {
    it('認証で定まった世帯をユースケースの第1引数に渡す', async () => {
      // C-9 / 規則5: 世帯はアクセストークンから定まり、必ず第1引数で渡る。
      const { routes, listIngredientNames } = setUp();

      await routes.request('/ingredient-names', { headers: authorizationHeaders() });

      expect(listIngredientNames.receivedHouseholdId).toBe(ourHousehold);
    });

    it('クエリの householdId を見ず、認証から定まった世帯だけを渡す', async () => {
      // 規則3 / C-9 / ADR-028: 世帯を利用者の入力から受け取らない。
      const { routes, listIngredientNames } = setUp();

      await routes.request(`/ingredient-names?householdId=${neighborHousehold}`, {
        headers: authorizationHeaders(),
      });

      expect(listIngredientNames.receivedHouseholdId).toBe(ourHousehold);
    });

    it('絞り込みの語をクエリで渡しても応答本体は変わらない', async () => {
      // 規則3: 絞るのは画面である（`docs/screen-design.md` 6章）。経路はクエリを1つも読まない。
      const { routes } = setUp();

      const response = await routes.request('/ingredient-names?prefix=にん', {
        headers: authorizationHeaders(),
      });

      await expect(response.json()).resolves.toEqual({ ingredientNames: ['にんじん', 'たまねぎ'] });
    });

    it('認証を通らない要求は食材名を求めない', async () => {
      // 規則4 / NFR-09: 世帯を定めるのが常に先。通らなければ DB に触れない。
      const { routes, listIngredientNames } = setUp({
        identifyHouseholdThrows: new IdentityRuleViolation(
          'accessToken.invalid',
          'アクセストークンが検証を通らない',
        ),
      });

      await routes.request('/ingredient-names', { headers: authorizationHeaders() });

      expect(listIngredientNames.callCount).toBe(0);
    });
  });

  describe('応答の本体', () => {
    it('応答本体はユースケースの出力そのままである', async () => {
      // 規則6 / ADR-063 決定4: 詰め替えも整形もせず、並びもそのまま返す。
      const { routes } = setUp();

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(),
      });

      await expect(response.json()).resolves.toEqual({ ingredientNames: ['にんじん', 'たまねぎ'] });
    });

    it('食材名が0件でも 200 で空の列を返す', async () => {
      // 規則7 / FR-03: 空を失敗として扱わない。補完は登録を止めない。
      const { routes } = setUp({ output: { ingredientNames: [] } });

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ingredientNames: [] });
    });

    it('応答本体に世帯を足さない', async () => {
      // C-9 / NFR-09: 世帯は応答に出さない。
      const { routes } = setUp();

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(),
      });

      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(['ingredientNames']);
    });
  });

  describe('アクセストークンの取り出し', () => {
    it('Authorization の Bearer の後ろの値をアクセストークンとして渡す', async () => {
      // 規則8 / NFR-09。
      const { routes, identifyHousehold } = setUp();

      await routes.request('/ingredient-names', { headers: authorizationHeaders() });

      expect(identifyHousehold.receivedAccessToken).toBe('access-token-a');
    });

    it('方式名が小文字の bearer でも世帯を定めて食材名を返す', async () => {
      // 規則8: 方式名の照合は大小を区別しない。
      const { routes, listIngredientNames } = setUp();

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(`bearer ${accessTokenA}`),
      });

      expect(response.status).toBe(200);
      expect(listIngredientNames.receivedHouseholdId).toBe(ourHousehold);
    });

    it('Bearer と値の区切りは最初の1空白とする', async () => {
      // 規則8: 残りは値の一部として渡す。正規化は腐敗防止層の仕事である。
      const { routes, identifyHousehold } = setUp();

      await routes.request('/ingredient-names', {
        headers: authorizationHeaders(`Bearer  ${accessTokenA}`),
      });

      expect(identifyHousehold.receivedAccessToken).toBe(' access-token-a');
    });

    it('Authorization ヘッダが無い要求は 401 を返す', async () => {
      // 規則8 / ADR-032: 判定は `IdentifyHousehold` に残り、api は空文字を渡す。
      const { routes } = setUp();

      const response = await routes.request('/ingredient-names');

      expect(response.status).toBe(401);
    });

    it('方式が Bearer でない要求は 401 を返す', async () => {
      // 規則8: 方式が違えば空文字を渡し、断りは `IdentifyHousehold` から返る。
      const { routes } = setUp();

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders('Basic YWJj'),
      });

      expect(response.status).toBe(401);
    });

    it('方式名だけで値の無いヘッダの要求は 401 を返す', async () => {
      // 規則8: 区切りが無いものは空文字として渡す。
      const { routes } = setUp();

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders('Bearer'),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('失敗の写像', () => {
    it('アクセストークンが検証を通らない要求は 401 を返し rule を載せる', async () => {
      // 7章 / ADR-032: 認証の規則違反は一律 401。
      const { routes } = setUp({
        identifyHouseholdThrows: new IdentityRuleViolation(
          'accessToken.invalid',
          'アクセストークンが検証を通らない',
        ),
      });

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(401);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'accessToken.invalid' });
    });

    it('表に無い認証の規則違反も 401 を返す', async () => {
      // 7章: 認証の規則違反は列挙を持たず、表に無い rule も 401 に落とす。
      const { routes } = setUp({
        identifyHouseholdThrows: new IdentityRuleViolation(
          'accessToken.unknownRule',
          '表に無い認証の規則違反',
        ),
      });

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(401);
    });

    it('表に無い献立の規則違反は 400 ではなく 500 を返し rule を載せる', async () => {
      // 7章 / ADR-062 決定3: 利用者の入力を受け取らない経路なので 400 を既定にしない。
      const { routes } = setUp({
        throws: new MealRuleViolation('meal.unknownRule', '表に無い献立の規則違反'),
      });

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'meal.unknownRule' });
    });

    it('規則違反でない失敗が起きたら 500 の unexpected を返す', async () => {
      // 7章 / ADR-045: 写せない失敗は 500 の unexpected に畳む。
      const { routes } = setUp({ throws: new Error('接続が切れた') });

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('500 の応答本体に例外の message を載せない', async () => {
      // 7章 / NFR-09: 接続文字列や設定の中身が応答に漏れる経路を作らない。
      const { routes } = setUp({ throws: new Error('setsuzoku-moji-retsu-himitsu') });

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(),
      });

      const text = await response.text();
      expect(parseBody(text)).toEqual({ rule: 'unexpected' });
      expect(text).not.toContain('setsuzoku-moji-retsu-himitsu');
    });

    it('世帯の特定で起きた認証でない失敗は 401 に化けない', async () => {
      // ADR-045 決定3: サーバ側の不備を利用者のアクセストークンのせいにしない。
      const { routes } = setUp({ identifyHouseholdThrows: new Error('鍵の設定が無い') });

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('在庫の規則違反は食材名の経路で規則違反として扱わない', async () => {
      // 7章: この経路が読むのは MealRuleViolation と IdentityRuleViolation だけ。
      const { routes } = setUp({ throws: new PantryRuleViolation('name.empty', '名称が空である') });

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });

    it('規則違反に似せた別の name の例外を規則違反として扱わない', async () => {
      // 7章 / ADR-032 決定2・結果2: 見分けるのは name である。
      const { routes } = setUp({ throws: ruleViolationLike('meal.notFound', '献立が無い') });

      const response = await routes.request('/ingredient-names', {
        headers: authorizationHeaders(),
      });

      expect(response.status).toBe(500);
      await expect(responseBody(response)).resolves.toEqual({ rule: 'unexpected' });
    });
  });
});
