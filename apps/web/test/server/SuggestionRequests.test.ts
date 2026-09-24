/**
 * 保存済みの提案を取りに行く継ぎ目（B-49a / B-58。先行 `StockItemRequests.test.ts`）。
 *
 * **観るのは戻り値と、出口が受け取った要求だけ**である（`docs/testing.md` 2章）。
 * `vi.fn()` で呼び出し回数を数えず、差し替えは `FixedHttpFetch` を渡す。
 */

import { describe, expect, it } from 'vitest';
import type { SuggestionOutput } from '@fridge-to-meal/contract';
import { FixedHttpFetch } from '../support/server/FixedHttpFetch.js';
import type { HttpDelivery } from '../support/server/FixedHttpFetch.js';
import { requestNewMeals, showLatestSuggestion } from '../../src/server/SuggestionRequests.js';

const BASE_URL = 'https://api.example.test';
const TOKEN = 'access-token';

const suggestion: SuggestionOutput = {
  id: 'suggestion-1',
  generatedAt: '2026-09-20T09:00:00.000Z',
  entries: [
    {
      mealId: 'meal-1',
      origin: 'reused',
      title: '豚こま肉と白菜の生姜焼き',
      ingredients: [{ name: '豚こま肉', kind: 'main', amount: '300g' }],
      steps: ['白菜を一口大に切る'],
      coverage: {
        covered: [{ name: '豚こま肉', kind: 'main', amount: '300g', expiryDate: '2026-09-20' }],
        missing: [],
      },
    },
  ],
};

/** トークンが取れる口。**空文字は `null` と同じに扱わない**（先行 `listStockItems`）。 */
const heldToken = () => Promise.resolve<string | null>(TOKEN);

function requestWith(delivery: HttpDelivery, accessToken = heldToken) {
  const httpFetch = new FixedHttpFetch(delivery);
  const request = showLatestSuggestion({
    baseUrl: BASE_URL,
    accessToken,
    httpFetch: httpFetch.httpFetch,
  });

  return { httpFetch, request };
}

describe('保存済みの提案を取りに行く継ぎ目 showLatestSuggestion', () => {
  it('基点に /suggestions/latest を足した先を GET で叩く', async () => {
    // 接頭辞を web の側で足さない（ADR-048 決定4）。この経路は生成を呼ばず費用も
    // 副作用も無いので GET である（ADR-065 決定2）。
    const { httpFetch, request } = requestWith({
      ok: true,
      body: { outcome: 'suggested', suggestion, pantryChanged: false },
    });

    await request();

    expect(httpFetch.receivedRequests).toHaveLength(1);
    expect(httpFetch.receivedRequests[0]?.url).toBe(`${BASE_URL}/suggestions/latest`);
    expect(httpFetch.receivedRequests[0]?.method).toBe('GET');
  });

  it('生成を呼ぶ経路（POST /suggestions）を叩かない', async () => {
    // **画面を出すだけで1日10回の枠（NFR-C2）を使わないことが、この継ぎ目の要点である。**
    const { httpFetch, request } = requestWith({
      ok: true,
      body: { outcome: 'suggested', suggestion, pantryChanged: false },
    });

    await request();

    expect(httpFetch.receivedRequests[0]?.url).not.toBe(`${BASE_URL}/suggestions`);
    expect(httpFetch.receivedRequests[0]?.url).not.toBe(`${BASE_URL}/suggestions/new-meals`);
  });

  it('アクセストークンを Bearer で載せ、本体を1つも送らない', async () => {
    // 要求の本体もクエリも api は読まない（B-48b 規則3・4）。本体が無いので
    // `Content-Type` も付けない — 付けると preflight の許可対象が増える。
    const { httpFetch, request } = requestWith({
      ok: true,
      body: { outcome: 'suggested', suggestion, pantryChanged: false },
    });

    await request();

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(httpFetch.receivedRequests[0]?.body).toBeUndefined();
  });

  it('トークンが取れなければ要求を出さず、失敗を返す', async () => {
    // 出しても 401 が返るだけで、往復を1つ無駄にする（先行 `listStockItems` 規則7）。
    // **件数を断定してよいのは「要求を出さない」が要件のこの1件だけである。**
    const { httpFetch, request } = requestWith(
      { ok: true, body: { outcome: 'suggested', suggestion, pantryChanged: false } },
      () => Promise.resolve(null),
    );

    expect(await request()).toEqual({ outcome: 'failed' });
    expect(httpFetch.receivedRequests).toHaveLength(0);
  });

  it('提案が返れば、その結末をそのまま返す', async () => {
    // **DTO を詰め替えない**（先行 `listStockItems` 規則2）。
    const { request } = requestWith({
      ok: true,
      body: { outcome: 'suggested', suggestion, pantryChanged: false },
    });

    expect(await request()).toEqual({ outcome: 'suggested', suggestion, pantryChanged: false });
  });

  it('在庫が変わっているという手がかりもそのまま返す', async () => {
    // ADR-065 決定4。見せ方を決めるのは画面であり、継ぎ目は写すだけである。
    const { request } = requestWith({
      ok: true,
      body: { outcome: 'suggested', suggestion, pantryChanged: true },
    });

    expect(await request()).toEqual({ outcome: 'suggested', suggestion, pantryChanged: true });
  });

  it('まだ提案が無い結末を、失敗に畳まずそのまま返す', async () => {
    // S-8 は失敗ではなく 200 で返る結末である（ADR-041 / ADR-065 決定3）。畳むと
    // 「一度も提案していない」と「取りに行けなかった」を画面が言い分けられなくなる。
    const { request } = requestWith({ ok: true, body: { outcome: 'none' } });

    expect(await request()).toEqual({ outcome: 'none' });
  });

  it('応答が ok でなければ失敗を返す', async () => {
    const { request } = requestWith({ ok: false, body: { rule: 'unexpected' } });

    expect(await request()).toEqual({ outcome: 'failed' });
  });

  it('本体が JSON として読めなければ失敗を返す', async () => {
    const { request } = requestWith({ ok: true, unreadableBody: true });

    expect(await request()).toEqual({ outcome: 'failed' });
  });

  it('出口が投げても、例外を外に出さず失敗を返す', async () => {
    // オフライン・到達不能・CORS で塞がれた回。外へ出すと門の効果で誰も受け止めず、
    // 読み込み中のまま画面が止まる（FR-41 / 先行 `listStockItems` 規則9）。
    const { request } = requestWith({ throws: new Error('到達できない') });

    expect(await request()).toEqual({ outcome: 'failed' });
  });

  it('知らない結末は失敗に畳む', async () => {
    const { request } = requestWith({ ok: true, body: { outcome: 'somethingElse' } });

    expect(await request()).toEqual({ outcome: 'failed' });
  });

  it('提案の1件の列が無い本体を、提案として受け取らない', async () => {
    // 0件の提案に倒さない — **献立があるのに無いように見せる**ことになる
    // （先行 `listStockItems` 規則9）。
    const { request } = requestWith({
      ok: true,
      body: { outcome: 'suggested', suggestion: {}, pantryChanged: false },
    });

    expect(await request()).toEqual({ outcome: 'failed' });
  });
});

/** `POST /suggestions/new-meals`（FR-36 の明示操作。B-49b）。 */
function requestNewMealsWith(delivery: HttpDelivery, accessToken = heldToken) {
  const httpFetch = new FixedHttpFetch(delivery);
  const request = requestNewMeals({
    baseUrl: BASE_URL,
    accessToken,
    httpFetch: httpFetch.httpFetch,
  });

  return { httpFetch, request };
}

describe('「新しい献立を求める」操作 requestNewMeals', () => {
  it('基点に /suggestions/new-meals を足した先を POST で叩く', async () => {
    // FR-36 の明示操作は必ず生成を呼ぶ（ADR-051）。接頭辞を web の側で足さない（ADR-048 決定4）。
    const { httpFetch, request } = requestNewMealsWith({
      ok: true,
      body: { outcome: 'suggested', suggestion },
    });

    await request();

    expect(httpFetch.receivedRequests).toHaveLength(1);
    expect(httpFetch.receivedRequests[0]?.url).toBe(`${BASE_URL}/suggestions/new-meals`);
    expect(httpFetch.receivedRequests[0]?.method).toBe('POST');
  });

  it('アクセストークンを Bearer で載せ、本体を1つも送らない', async () => {
    // 世帯も入力もアクセストークンから定まる（B-48b 規則3・4）。
    const { httpFetch, request } = requestNewMealsWith({
      ok: true,
      body: { outcome: 'suggested', suggestion },
    });

    await request();

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(httpFetch.receivedRequests[0]?.body).toBeUndefined();
  });

  it('トークンが取れなければ要求を出さず、失敗を返す', async () => {
    // 先行 `showLatestSuggestion` 規則と同じ構え。**件数を断定してよい唯一の観点。**
    const { httpFetch, request } = requestNewMealsWith(
      { ok: true, body: { outcome: 'suggested', suggestion } },
      () => Promise.resolve(null),
    );

    expect(await request()).toEqual({ outcome: 'failed' });
    expect(httpFetch.receivedRequests).toHaveLength(0);
  });

  it('提案が返れば、その結末をそのまま返す', async () => {
    // DTO を詰め替えない（先行 `showLatestSuggestion` / `listStockItems` 規則2）。
    const { request } = requestNewMealsWith({
      ok: true,
      body: { outcome: 'suggested', suggestion },
    });

    expect(await request()).toEqual({ outcome: 'suggested', suggestion });
  });

  it('在庫が足りない結末を、失敗に畳まずそのまま返す', async () => {
    // S-4。ADR-049 結果7 — この2つの表示は B-49c の持ち分だが、取り違えないことはここで満たす。
    const { request } = requestNewMealsWith({
      ok: true,
      body: { outcome: 'insufficientStockItems' },
    });

    expect(await request()).toEqual({ outcome: 'insufficientStockItems' });
  });

  it('生成の上限に達した結末を、失敗に畳まずそのまま返す', async () => {
    // S-7 / NFR-C2 / ADR-049。
    const { request } = requestNewMealsWith({
      ok: true,
      body: { outcome: 'generationLimitReached' },
    });

    expect(await request()).toEqual({ outcome: 'generationLimitReached' });
  });

  it('応答が ok でなければ失敗を返す', async () => {
    const { request } = requestNewMealsWith({ ok: false, body: { rule: 'someRuleViolation' } });

    expect(await request()).toEqual({ outcome: 'failed' });
  });

  it('502（mealGenerator.empty。S-6）も同じ失敗として畳む', async () => {
    // NFR-07。個別の文言で区別せず、操作そのものが再試行の手段を兼ねる（設計 7章）。
    const { request } = requestNewMealsWith({ ok: false, body: { rule: 'mealGenerator.empty' } });

    expect(await request()).toEqual({ outcome: 'failed' });
  });

  it('本体が JSON として読めなければ失敗を返す', async () => {
    const { request } = requestNewMealsWith({ ok: true, unreadableBody: true });

    expect(await request()).toEqual({ outcome: 'failed' });
  });

  it('出口が投げても、例外を外に出さず失敗を返す', async () => {
    const { request } = requestNewMealsWith({ throws: new Error('到達できない') });

    expect(await request()).toEqual({ outcome: 'failed' });
  });

  it('知らない結末は失敗に畳む', async () => {
    const { request } = requestNewMealsWith({ ok: true, body: { outcome: 'somethingElse' } });

    expect(await request()).toEqual({ outcome: 'failed' });
  });

  it('suggestion の形が壊れているときは提案として受け取らず失敗を返す', async () => {
    // 0件の提案に倒さない — 献立があるのに無いように見せることになる（先行と同じ構え）。
    const { request } = requestNewMealsWith({
      ok: true,
      body: { outcome: 'suggested', suggestion: {} },
    });

    expect(await request()).toEqual({ outcome: 'failed' });
  });
});
