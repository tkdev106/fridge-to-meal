/**
 * 献立1件を取りに行く継ぎ目と、調理記録を1件足す継ぎ目（B-53 1周目。先行
 * `SuggestionRequests.test.ts` / `StockItemRequests.test.ts`）。
 *
 * **観るのは戻り値と、出口が受け取った要求だけ**である（`docs/testing.md` 2章）。
 * `vi.fn()` で呼び出し回数を数えず、差し替えは `FixedHttpFetch` を渡す。
 */

import { describe, expect, it } from 'vitest';
import type { MealOutput } from '@fridge-to-meal/contract';
import { FixedHttpFetch } from '../support/server/FixedHttpFetch.js';
import type { HttpDelivery } from '../support/server/FixedHttpFetch.js';
import { addCookingRecord, showMeal } from '../../src/server/MealRequests.js';

const BASE_URL = 'https://api.example.test';
const TOKEN = 'access-token';
const MEAL_ID = 'meal-1';

/** 標本は主材料1件＋調味料1件・手順1件・充足あり（設計 5章 `MealOutput`）。 */
const meal: MealOutput = {
  mealId: MEAL_ID,
  title: '豚こま肉と白菜の生姜焼き',
  ingredients: [
    { name: '豚こま肉', kind: 'main', amount: '300g' },
    { name: '醤油', kind: 'seasoning', amount: '大さじ2' },
  ],
  steps: ['白菜を一口大に切る'],
  coverage: {
    covered: [{ name: '豚こま肉', kind: 'main', amount: '300g', expiryDate: '2026-09-20' }],
    missing: [{ name: 'しょうが', kind: 'main', amount: '1かけ' }],
  },
};

/** トークンが取れる口。**空文字は `null` と同じに扱わない**（先行 `listStockItems`）。 */
const heldToken = () => Promise.resolve<string | null>(TOKEN);

function showWith(delivery: HttpDelivery, accessToken = heldToken) {
  const httpFetch = new FixedHttpFetch(delivery);
  const request = showMeal({ baseUrl: BASE_URL, accessToken, httpFetch: httpFetch.httpFetch });

  return { httpFetch, request };
}

function recordWith(delivery: HttpDelivery, accessToken = heldToken) {
  const httpFetch = new FixedHttpFetch(delivery);
  const request = addCookingRecord({
    baseUrl: BASE_URL,
    accessToken,
    httpFetch: httpFetch.httpFetch,
  });

  return { httpFetch, request };
}

/** 通った応答1つぶん（献立をそのまま本体に載せる）。 */
const shown: HttpDelivery = { ok: true, body: meal };

describe('献立1件を取りに行く継ぎ目 showMeal', () => {
  it('献立が返れば、その中身をそのまま結末に載せる', async () => {
    // **DTO を詰め替えない**（規則15）。web に第2の DTO を作らない。
    const { request } = showWith(shown);

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'shown', meal });
  });

  it('材料を並べ替えず、件数も数えずそのまま返す', async () => {
    // 並びと印の判断は画面側の純粋関数の持ち分である（規則15 / 規則2）。
    const unsorted: MealOutput = {
      ...meal,
      ingredients: [
        { name: '醤油', kind: 'seasoning', amount: '大さじ2' },
        { name: '豚こま肉', kind: 'main', amount: '300g' },
      ],
    };
    const { request } = showWith({ ok: true, body: unsorted });

    const outcome = await request(MEAL_ID);

    expect(outcome).toEqual({ outcome: 'shown', meal: unsorted });
  });

  it('材料も手順も0件の献立を、失敗に畳まずそのまま返す', async () => {
    // 献立は取れている（規則6）。断ると材料も手順も読めなくなる。
    const empty: MealOutput = {
      ...meal,
      ingredients: [],
      steps: [],
      coverage: { covered: [], missing: [] },
    };
    const { request } = showWith({ ok: true, body: empty });

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'shown', meal: empty });
  });

  it('基点に /meals と識別子を足した先を GET で叩き、世帯を1つも載せない', async () => {
    // 接頭辞を web の側で足さない（ADR-048 決定4）。世帯はアクセストークンから定まる
    // （C-9 / NFR-09）。
    const { httpFetch, request } = showWith(shown);

    await request(MEAL_ID);

    expect(httpFetch.receivedRequests[0]?.url).toBe(`${BASE_URL}/meals/${MEAL_ID}`);
    expect(httpFetch.receivedRequests[0]?.method).toBe('GET');
  });

  it('識別子に経路の区切りが混ざっても1つの区切りとして送る', async () => {
    // ADR-026 / 規則16: 経路の一部として解かれないよう符号化する。
    const { httpFetch, request } = showWith(shown);

    await request('meal/../health');

    expect(httpFetch.receivedRequests[0]?.url).toBe(`${BASE_URL}/meals/meal%2F..%2Fhealth`);
  });

  it('識別子の前後の空白を落とさずそのまま経路に載せる', async () => {
    // 規則16: **加工しない。** 直すのはサーバの仕事である。
    const { httpFetch, request } = showWith(shown);

    await request(' meal-1 ');

    expect(httpFetch.receivedRequests[0]?.url).toBe(`${BASE_URL}/meals/%20meal-1%20`);
  });

  it('アクセストークンを Bearer で載せ、本体を1つも送らない', async () => {
    // 要求の本体もクエリも api は読まない（B-48b 規則3・4）。本体が無いので
    // `Content-Type` も付けない（ADR-048）。
    const { httpFetch, request } = showWith(shown);

    await request(MEAL_ID);

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(httpFetch.receivedRequests[0]?.body).toBeUndefined();
  });

  it('アクセストークンが取れなければ失敗の結末を返す', async () => {
    const { request } = showWith(shown, () => Promise.resolve(null));

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンが取れなければ要求を1つも出さない', async () => {
    // 出しても 401 が返るだけで、往復を1つ無駄にする（先行 `listStockItems` 規則7）。
    // **件数を断定する唯一のケースである**（`docs/testing.md` 2章が認める例外）。
    const { httpFetch, request } = showWith(shown, () => Promise.resolve(null));

    await request(MEAL_ID);

    expect(httpFetch.receivedRequests).toEqual([]);
  });

  it('アクセストークンが空文字でも要求を出し、空のまま Bearer に載せる', async () => {
    // **空文字は `null` と同じに扱わない**（先行 `listStockItems` 規則7）。
    const { httpFetch, request } = showWith(shown, () => Promise.resolve(''));

    await request(MEAL_ID);

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({ Authorization: 'Bearer ' });
  });

  it('見つからない断りの rule をそのまま結末に載せる', async () => {
    // 失敗と同じ案内に畳むかどうかは画面の判断である（ADR-032 決定3 / 7章）。
    const { request } = showWith({ ok: false, body: { rule: 'showMeal.mealNotFound' } });

    await expect(request(MEAL_ID)).resolves.toEqual({
      outcome: 'rejected',
      rule: 'showMeal.mealNotFound',
    });
  });

  it('認証の断りの rule もそのまま結末に載せる', async () => {
    // 継ぎ目は `rule` の意味を読まない（ADR-032 決定3）。列挙を web に持たない。
    const { request } = showWith({ ok: false, body: { rule: 'accessToken.missing' } });

    await expect(request(MEAL_ID)).resolves.toEqual({
      outcome: 'rejected',
      rule: 'accessToken.missing',
    });
  });

  it('断りの応答に rule が無ければ失敗の結末を返す', async () => {
    // `rejected` は `rule` を持つ本体が読めたときだけである（規則14）。
    const { request } = showWith({ ok: false, body: {} });

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'failed' });
  });

  it('断りの本体が JSON として読めなければ失敗の結末を返す', async () => {
    const { request } = showWith({ ok: false, unreadableBody: true });

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'failed' });
  });

  it('通った応答の本体が JSON として読めなければ失敗の結末を返す', async () => {
    // 献立詳細は本体が中身そのものである。読めなければ描くものが無い。
    const { request } = showWith({ ok: true, unreadableBody: true });

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'failed' });
  });

  it('出口が投げても、例外を外に出さず失敗の結末を返す', async () => {
    // 外へ出すと門の効果で誰も受け止めず、読み込み中のまま画面が止まる（FR-41 / 規則14）。
    const { request } = showWith({ throws: new Error('到達できない') });

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'failed' });
  });

  it('献立の形が壊れている本体を、献立として受け取らない', async () => {
    const { request } = showWith({ ok: true, body: {} });

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'failed' });
  });

  it('充足を欠いた本体も、献立として受け取らない', async () => {
    // 見るのは `ingredients` / `steps` / `coverage.covered` / `coverage.missing` の4つが
    // 配列であることまでで、**それ以上は検めない**（先行 `isSuggested` の構え）。
    const { request } = showWith({
      ok: true,
      body: { mealId: MEAL_ID, title: meal.title, ingredients: [], steps: [] },
    });

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'failed' });
  });
});

/** 通った応答1つぶん（204 を写した本体なしの応答）。 */
const recorded: HttpDelivery = { ok: true, body: undefined };

describe('調理記録を1件足す継ぎ目 addCookingRecord', () => {
  it('応答が通れば記録できた結末を返す', async () => {
    // 通った回は 204 で本体なしである（B-51）。
    const { request } = recordWith(recorded);

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'recorded' });
  });

  it('基点に /meals と識別子と /cooking-records を足した先を POST で叩き、世帯を1つも載せない', async () => {
    const { httpFetch, request } = recordWith(recorded);

    await request(MEAL_ID);

    expect(httpFetch.receivedRequests[0]?.url).toBe(`${BASE_URL}/meals/${MEAL_ID}/cooking-records`);
    expect(httpFetch.receivedRequests[0]?.method).toBe('POST');
  });

  it('識別子に経路の区切りが混ざっても1つの区切りとして送る', async () => {
    const { httpFetch, request } = recordWith(recorded);

    await request('meal/../health');

    expect(httpFetch.receivedRequests[0]?.url).toBe(
      `${BASE_URL}/meals/meal%2F..%2Fhealth/cooking-records`,
    );
  });

  it('記録の日時も本体も1つも送らず、アクセストークンだけを載せる', async () => {
    // 記録の日時はサーバが要求ごとに時計を読む（B-48b 規則4）。web から送らない。
    const { httpFetch, request } = recordWith(recorded);

    await request(MEAL_ID);

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(httpFetch.receivedRequests[0]?.body).toBeUndefined();
  });

  it('アクセストークンが取れなければ失敗の結末を返す', async () => {
    const { request } = recordWith(recorded, () => Promise.resolve(null));

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンが取れなければ要求を1つも出さない', async () => {
    const { httpFetch, request } = recordWith(recorded, () => Promise.resolve(null));

    await request(MEAL_ID);

    expect(httpFetch.receivedRequests).toEqual([]);
  });

  it('アクセストークンが空文字でも要求を出し、空のまま Bearer に載せる', async () => {
    const { httpFetch, request } = recordWith(recorded, () => Promise.resolve(''));

    await request(MEAL_ID);

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({ Authorization: 'Bearer ' });
  });

  it('見つからない断りの rule をそのまま結末に載せる', async () => {
    // 案内に畳むのは画面の純粋関数である（規則13 / ADR-032 決定3）。
    const { request } = recordWith({ ok: false, body: { rule: 'addCookingRecord.mealNotFound' } });

    await expect(request(MEAL_ID)).resolves.toEqual({
      outcome: 'rejected',
      rule: 'addCookingRecord.mealNotFound',
    });
  });

  it('断りの応答に rule が無ければ失敗の結末を返す', async () => {
    const { request } = recordWith({ ok: false, body: {} });

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'failed' });
  });

  it('断りの本体が JSON として読めなければ失敗の結末を返す', async () => {
    const { request } = recordWith({ ok: false, unreadableBody: true });

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'failed' });
  });

  it('出口が投げても、例外を外に出さず失敗の結末を返す', async () => {
    const { request } = recordWith({ throws: new Error('到達できない') });

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'failed' });
  });

  it('通った応答の本体を読まないので、読めない本体でも記録できた結末を返す', async () => {
    // **`showMeal` と逆向きである** — 記録の応答は 204 で本体を持たない（B-51）。
    const { request } = recordWith({ ok: true, unreadableBody: true });

    await expect(request(MEAL_ID)).resolves.toEqual({ outcome: 'recorded' });
  });
});
