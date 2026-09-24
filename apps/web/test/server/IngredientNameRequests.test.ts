/**
 * 食材名を取りに行く継ぎ目（B-50c 設計 5章。先行 `SuggestionRequests.test.ts`）。
 *
 * **観るのは戻り値と、出口が受け取った要求だけ**である（`docs/testing.md` 2章）。
 * `vi.fn()` で呼び出し回数を数えず、差し替えは `FixedHttpFetch` を渡す。
 */

import { describe, expect, it } from 'vitest';
import { FixedHttpFetch } from '../support/server/FixedHttpFetch.js';
import type { HttpDelivery } from '../support/server/FixedHttpFetch.js';
import { listIngredientNames } from '../../src/server/IngredientNameRequests.js';

const BASE_URL = 'https://api.example.test';
const TOKEN = 'access-token';

/** サーバが返す名称の列。**コード単位の昇順で畳まれている**（ADR-063 決定4）。 */
const names = ['たまねぎ', 'にんじん', '豚こま肉'];

/** トークンが取れる口。**空文字は `null` と同じに扱わない**（先行 `listStockItems`）。 */
const heldToken = () => Promise.resolve<string | null>(TOKEN);

function requestWith(delivery: HttpDelivery, accessToken = heldToken) {
  const httpFetch = new FixedHttpFetch(delivery);
  const request = listIngredientNames({
    baseUrl: BASE_URL,
    accessToken,
    httpFetch: httpFetch.httpFetch,
  });

  return { httpFetch, request };
}

describe('食材名を取りに行く継ぎ目 listIngredientNames', () => {
  it('基点に /ingredient-names を足した先を GET で叩く', async () => {
    // 接頭辞を web の側で足さない（B-22 設計 規則15）。読み取りだけで費用も副作用も
    // 無いので GET である（ADR-063 / B-50b）。
    const { httpFetch, request } = requestWith({ ok: true, body: { ingredientNames: names } });

    await request();

    expect(httpFetch.receivedRequests).toHaveLength(1);
    expect(httpFetch.receivedRequests[0]?.url).toBe(`${BASE_URL}/ingredient-names`);
    expect(httpFetch.receivedRequests[0]?.method).toBe('GET');
  });

  it('アクセストークンだけを載せ、本体を持たない', async () => {
    // 本体が無いので `Content-Type` を付けない（付けると preflight の許可対象が増える。ADR-048）。
    const { httpFetch, request } = requestWith({ ok: true, body: { ingredientNames: names } });

    await request();

    expect(httpFetch.receivedRequests[0]?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(httpFetch.receivedRequests[0]?.body).toBeUndefined();
  });

  it('取れた名称を詰め替えも並べ替えもせずそのまま返す', async () => {
    // 並び（コード単位の昇順）と重複の畳み方を決めるのはサーバである（ADR-063 決定4）。
    const { request } = requestWith({ ok: true, body: { ingredientNames: names } });

    await expect(request()).resolves.toEqual({ outcome: 'loaded', ingredientNames: names });
  });

  it('0件でも取れたこととして返す', async () => {
    const { request } = requestWith({ ok: true, body: { ingredientNames: [] } });

    await expect(request()).resolves.toEqual({ outcome: 'loaded', ingredientNames: [] });
  });

  it('アクセストークンが取れなければ要求を出さない', async () => {
    // 出しても 401 が返るだけで、往復を1つ無駄にする（先行 `listStockItems` 規則7）。
    const { httpFetch, request } = requestWith({ ok: true, body: { ingredientNames: names } }, () =>
      Promise.resolve(null),
    );

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
    expect(httpFetch.receivedRequests).toHaveLength(0);
  });

  it('断られた応答は failed に畳む', async () => {
    const { request } = requestWith({ ok: false, body: { rule: 'unexpected' } });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('本体が読めなければ failed に畳む', async () => {
    const { request } = requestWith({ ok: true, unreadableBody: true });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('ingredientNames が配列でなければ failed に畳む', async () => {
    // **0件の loaded に倒さない** — 名称があるのに無いように見せることになる（先行 `isListed`）。
    const { request } = requestWith({ ok: true, body: { ingredientNames: 'にんじん' } });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('出口が投げても例外を外に出さない', async () => {
    // 外へ出すと門の効果で誰も受け止めない（B-22 設計 規則9 / FR-41）。
    const { request } = requestWith({ throws: new Error('到達できない') });

    await expect(request()).resolves.toEqual({ outcome: 'failed' });
  });

  it('呼ばれた1回で1往復しかせず、自分では取りに行き直さない', async () => {
    const { httpFetch, request } = requestWith({ throws: new Error('到達できない') });

    await request();

    expect(httpFetch.receivedRequests).toHaveLength(1);
  });
});
