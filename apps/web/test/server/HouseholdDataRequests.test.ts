/**
 * 世帯のデータを消す継ぎ目（B-56f 1周目 / 設計 6章 規則1〜3・9 / 7章。先行
 * `MealRequests.test.ts` の `listMeals`、`StockItemRequests.test.ts` の `deleteStockItem`）。
 *
 * **観るのは戻り値と、出口が受け取った要求だけ**である（`docs/testing.md` 2章）。
 * `vi.fn()` で呼び出し回数を数えず、差し替えは `FixedHttpFetch` を渡す。
 */

import { describe, expect, it } from 'vitest';
import { FixedHttpFetch } from '../support/server/FixedHttpFetch.js';
import type { HttpDelivery } from '../support/server/FixedHttpFetch.js';
import { deleteHouseholdData } from '../../src/server/HouseholdDataRequests.js';

const BASE_URL = 'https://api.example.test';
const TOKEN = 'access-token';

/** トークンが取れる口。**空文字は `null` と同じに扱わない**（先行 `listStockItems`）。 */
const heldToken = () => Promise.resolve<string | null>(TOKEN);

function deleteWith(delivery: HttpDelivery, accessToken = heldToken) {
  const httpFetch = new FixedHttpFetch(delivery);
  const request = deleteHouseholdData({
    baseUrl: BASE_URL,
    accessToken,
    httpFetch: httpFetch.httpFetch,
  });

  return { httpFetch, request };
}

/** 通った応答1つぶん（204 を写した本体なしの応答。B-56a）。 */
const deleted: HttpDelivery = { ok: true, body: undefined };

describe('世帯のデータを消す継ぎ目 deleteHouseholdData', () => {
  it('応答が通れば、消えた結末を返す', async () => {
    // 規則3: 通った回は 204 で本体なしである（B-56a）。
    const { request } = deleteWith(deleted);

    await expect(request()).resolves.toEqual({ outcome: 'deleted' });
  });

  it('通った応答の本体を読まないので、読めない本体でも消えた結末を返す', async () => {
    // 規則3: 2xx は本体を読まない（先行 `deleteStockItem` / `addCookingRecord`）。
    const { request } = deleteWith({ ok: true, unreadableBody: true });

    await expect(request()).resolves.toEqual({ outcome: 'deleted' });
  });

  it('基点に /household-data を足した先を DELETE で叩く', async () => {
    // 規則1 / ADR-048 決定4: 接頭辞を web の側で足さない。規則9 / C-9: 世帯を経路にもクエリにも
    // 載せない — URL の完全一致で、足されたものが無いことまで見る。
    const { httpFetch, request } = deleteWith(deleted);

    await request();

    expect(httpFetch.receivedRequests[0]?.url).toBe(`${BASE_URL}/household-data`);
    expect(httpFetch.receivedRequests[0]?.method).toBe('DELETE');
  });

  it('アクセストークンを Bearer で載せ、それ以外のヘッダを付けない', async () => {
    // 規則1: 本体が無いので `Content-Type` も付けない（ADR-048）。規則9: 世帯はトークンから定まる。
    const { httpFetch, request } = deleteWith(deleted);

    await request();

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it('本体を1つも送らない', async () => {
    // 規則1 / 規則9 / B-56a 規則9: 要求の本体を api は読まない。
    const { httpFetch, request } = deleteWith(deleted);

    await request();

    expect(httpFetch.receivedRequests[0]?.body).toBeUndefined();
  });

  it('アクセストークンが取れなければ、失敗の結末を返す', async () => {
    // 規則2 / 7章 行1
    const { request } = deleteWith(deleted, () => Promise.resolve(null));

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンが取れなければ、要求を1つも出さない', async () => {
    // 規則2: 出しても 401 が返るだけである。**件数を断定するのは起きないことが要件のこの
    // 1件と、1往復だけのケースに限る**（`docs/testing.md` 2章）。
    const { httpFetch, request } = deleteWith(deleted, () => Promise.resolve(null));

    await request();

    expect(httpFetch.receivedRequests).toEqual([]);
  });

  it('アクセストークンが空文字でも要求を出し、空のまま Bearer に載せる', async () => {
    // 規則2 / 先行 `listStockItems` 規則7: 空文字は `null` と同じに扱わない。
    const { httpFetch, request } = deleteWith(deleted, () => Promise.resolve(''));

    await request();

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({ Authorization: 'Bearer ' });
  });

  it('認証を通らない応答は、失敗の結末を返す', async () => {
    // 規則3 / 7章 行2: 401 も失敗に畳む。
    const { request } = deleteWith({ ok: false, body: { rule: 'accessToken.invalid' } });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('断りの本体に rule があっても運ばず、失敗の結末だけを返す', async () => {
    // 規則3 / 7章 行3: `rule` を読み分けない（利用者が直せる入力が無い。先行 `listMeals`）。
    // 完全一致で、`rule` のキーが結末に無いことまで見る。
    const { request } = deleteWith({ ok: false, body: { rule: 'unexpected' } });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('出口が投げても、例外を外に出さず失敗の結末を返す', async () => {
    // 規則3 / 7章 行4 / FR-41: 通信の失敗も失敗に畳み、外へ出さない。
    const { request } = deleteWith({ throws: new Error('到達できない') });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンの取り出しが投げても、例外を外に出さず失敗の結末を返す', async () => {
    // 規則3: 例外を外に出さない。
    const { request } = deleteWith(deleted, () => Promise.reject(new Error('取り出せない')));

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('失敗しても、呼ばれた1回で1往復しかせず送り直さない', async () => {
    // 規則1「1回だけ叩く」/ 規則3: 自分では再試行しない。
    const { httpFetch, request } = deleteWith({ ok: false, body: { rule: 'unexpected' } });

    await request();

    expect(httpFetch.receivedRequests).toHaveLength(1);
  });
});
