import { describe, expect, it } from 'vitest';
import type { StockItemDto } from '@fridge-to-meal/contract';
import type { ListStockItems, StockItemsOutcome } from '../../src/server/StockItemRequests.js';
import { listStockItems } from '../../src/server/StockItemRequests.js';
import type { ReceivedRequest } from '../support/server/FixedHttpFetch.js';
import { FixedHttpFetch } from '../support/server/FixedHttpFetch.js';

// 標本（`docs/testing.md` 6章）。基点とトークンは**互いに見分けのつく**文字列にする。
const baseUrl = 'https://api.example.dev';
const accessToken = 'access-token-example';

/**
 * 応答が届ける在庫品2件。**互いに見分けのつく名称**にし、`ingredientId` / `amount` /
 * `expiryDate` に `null` を混ぜる — 詰め替える実装（規則2）が緑にならないためである。
 */
const carrot: StockItemDto = {
  id: 'stock-item-carrot',
  name: 'にんじん',
  ingredientId: 'ingredient-carrot',
  amount: '2本',
  expiryDate: '2026-09-21',
};
const pork: StockItemDto = {
  id: 'stock-item-pork',
  name: 'ぶたにく',
  ingredientId: null,
  amount: null,
  expiryDate: null,
};

/** 通る応答。本題が応答の形でないケースはこれを届ける。 */
function listed(...stockItems: readonly StockItemDto[]) {
  return { ok: true, body: { stockItems: [...stockItems] } } as const;
}

/**
 * 取りに行く口を1つ組む。本題（届ける応答・トークンの取り出し方）だけが引数に現れる形にする
 * （`docs/testing.md` 6章）。**空文字の `baseUrl` は組む側の話なのでここでは扱わない**（設計 10章）。
 */
function listing(
  httpFetch: FixedHttpFetch,
  accessTokenOf: () => Promise<string | null> = async () => accessToken,
): ListStockItems {
  return listStockItems({ baseUrl, accessToken: accessTokenOf, httpFetch: httpFetch.httpFetch });
}

/**
 * 出た要求がちょうど1つであることを確かめて取り出す。**ヘッダを見る3件（S5 / S6 / S9）だけが使う** —
 * 要求の件数そのものを仕様にするのは規則7 の1件だけである（`docs/testing.md` 2章）。
 */
function onlyRequest(httpFetch: FixedHttpFetch): ReceivedRequest {
  const [request, ...rest] = httpFetch.receivedRequests;

  if (request === undefined || rest.length > 0) {
    throw new Error(`出た要求が1つではない: ${httpFetch.receivedRequests.length} 件`);
  }

  return request;
}

/** `loaded` の結末から在庫品の列を取り出す。**並びだけを見る1件（S2）が使う。** */
function loadedStockItems(outcome: StockItemsOutcome): readonly StockItemDto[] {
  if (outcome.outcome !== 'loaded') {
    throw new Error(`loaded ではない結末: ${outcome.outcome}`);
  }

  return outcome.stockItems;
}

describe('在庫一覧の取得 listStockItems', () => {
  it('応答の在庫品をそのまま loaded の結末で返す', async () => {
    // FR-04 / B-22 設計 規則2・9: DTO を詰め替えない。**期待値は literal で置く**
    // （`docs/testing.md` 3章）— 欄を落とす実装が緑にならないため。
    const outcome = await listing(new FixedHttpFetch(listed(carrot, pork)))();

    expect(outcome).toEqual({
      outcome: 'loaded',
      stockItems: [
        {
          id: 'stock-item-carrot',
          name: 'にんじん',
          ingredientId: 'ingredient-carrot',
          amount: '2本',
          expiryDate: '2026-09-21',
        },
        {
          id: 'stock-item-pork',
          name: 'ぶたにく',
          ingredientId: null,
          amount: null,
          expiryDate: null,
        },
      ],
    });
  });

  it('応答の並びを変えずにそのまま返す', async () => {
    // FR-04 / B-22 設計 規則3: 並べ替えない。サーバの並び（期限の近い順）をそのまま渡す。
    // 期限が null のものを先頭に置く — 期限で並べ替える実装なら後ろへ動く。
    const outcome = await listing(new FixedHttpFetch(listed(pork, carrot)))();

    expect(loadedStockItems(outcome).map((stockItem) => stockItem.name)).toEqual([
      'ぶたにく',
      'にんじん',
    ]);
  });

  it('在庫が0件の応答でも loaded の結末で空の列を返す', async () => {
    // FR-04 / B-22 設計 規則9: 0件は失敗ではない（冷蔵庫が空なだけである）。
    const outcome = await listing(new FixedHttpFetch(listed()))();

    expect(outcome).toEqual({ outcome: 'loaded', stockItems: [] });
  });

  it('叩く先は基点に /stock-items を足した1つだけで世帯を表すものを載せない', async () => {
    // B-22 設計 規則6・15 / C-9 / NFR-09: 接頭辞を web の側で足さない。世帯は経路にも
    // クエリにも載せず、サーバがアクセストークンから定める。
    const httpFetch = new FixedHttpFetch(listed(carrot));

    await listing(httpFetch)();

    expect(httpFetch.receivedRequests.map((request) => request.url)).toEqual([
      'https://api.example.dev/stock-items',
    ]);
  });

  it('取り出したアクセストークンを Authorization の Bearer に載せる', async () => {
    // B-22 設計 規則8 / ADR-043: トークンはヘッダで運ぶ（Cookie の経路を作らない）。
    const httpFetch = new FixedHttpFetch(listed(carrot));

    await listing(httpFetch)();

    expect(onlyRequest(httpFetch).headers.Authorization).toBe('Bearer access-token-example');
  });

  it('GET に Content-Type を付けない', async () => {
    // B-22 設計 規則8: 本体が無いので要らず、付けると preflight の許可対象が増える。
    const httpFetch = new FixedHttpFetch(listed(carrot));

    await listing(httpFetch)();

    expect(onlyRequest(httpFetch).headers).toEqual({
      Authorization: 'Bearer access-token-example',
    });
  });

  it('アクセストークンが null なら failed の結末を返す', async () => {
    // B-22 設計 規則7 / 7章: 出しても 401 が返るだけである。
    const outcome = await listing(new FixedHttpFetch(listed(carrot)), async () => null)();

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('アクセストークンが null なら要求を1つも出さない', async () => {
    // B-22 設計 規則7: **出さないこと自体が要件**（`docs/testing.md` 2章の例外）。
    // **通る応答を用意しておく** — 誤って出た回も最後まで通り、落ちるのは件数の断定だけになる。
    const httpFetch = new FixedHttpFetch(listed(carrot));

    await listing(httpFetch, async () => null)();

    expect(httpFetch.receivedRequests.map((request) => request.url)).toEqual([]);
  });

  it('アクセストークンが空文字でも要求を出し空のまま Bearer に載せる', async () => {
    // B-22 設計 規則7 後半: 「提示されていない」の判定は api と `IdentifyHousehold` の側に
    // 1か所だけ残す。web で null と同じに畳まない。
    const httpFetch = new FixedHttpFetch(listed(carrot));

    await listing(httpFetch, async () => '')();

    expect(onlyRequest(httpFetch).headers.Authorization).toBe('Bearer ');
  });

  it('応答の ok が偽なら本体が読めても failed の結末を返す', async () => {
    // B-22 設計 規則9 / 7章: 401 も 500 も同じ1つの結末に畳む（種別を分けない）。
    const outcome = await listing(
      new FixedHttpFetch({ ok: false, body: { stockItems: [carrot] } }),
    )();

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('通信が失敗して出口が投げても例外を外に出さず failed の結末を返す', async () => {
    // B-22 設計 規則9 / FR-41: 外へ出すと `App.tsx` の効果で誰も受け止めず、
    // 読み込み中のまま画面が止まる。
    const httpFetch = new FixedHttpFetch({ throws: new Error('取りに行けない') });

    await expect(listing(httpFetch)()).resolves.toEqual({ outcome: 'failed' });
  });

  it('応答の本体が JSON として読めなければ failed の結末を返す', async () => {
    // B-22 設計 規則9 / 7章: 本体が読めないことも1つの結末に畳む。
    const outcome = await listing(new FixedHttpFetch({ ok: true, unreadableBody: true }))();

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('応答の stockItems が配列でなければ failed の結末を返す', async () => {
    // B-22 設計 規則9 / 7章: 配列でないものを画面に渡すと、出し分けの側で落ちる。
    const outcome = await listing(
      new FixedHttpFetch({ ok: true, body: { stockItems: 'にんじん' } }),
    )();

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('応答の本体に stockItems が無ければ0件ではなく failed の結末を返す', async () => {
    // B-22 設計 規則9 / 7章: 0件の `loaded` に倒すと、**在庫があるのに無いように見せる**。
    const outcome = await listing(new FixedHttpFetch({ ok: true, body: {} }))();

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('在庫品1件の中身が欠けていても検めずに loaded の結末で返す', async () => {
    // B-22 設計 規則9 後半 / 規則2: **要素の中身は見ない** — 相手は自分のサーバであり、
    // contract の型で返す側が正である。検めを足すと web が第2の DTO を持つ。
    const outcome = await listing(
      new FixedHttpFetch({ ok: true, body: { stockItems: [{ name: 'にんじん' }] } }),
    )();

    expect(outcome).toEqual({ outcome: 'loaded', stockItems: [{ name: 'にんじん' }] });
  });

  it('1度失敗したら自分では取りに行き直さない', async () => {
    // B-22 設計 規則10 / FR-41: **自動で再試行しない**。2度目の応答が結果に現れないことで見る
    // （**回数は数えない** — 数えるのは要求を出さないことが要件の1件だけ）。
    const httpFetch = new FixedHttpFetch({ ok: false, body: {} }, listed(carrot));

    const outcome = await listing(httpFetch)();

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('アクセストークンの取り出しが投げても例外を外に出さず failed の結末を返す', async () => {
    // B-22 設計 規則9 / 7章 / `Session.ts` 規則7: `SessionImpl.accessToken` は `getSession()` の
    // `error` を見ずに `data` を読むため投げうる。画面から見れば「いま取りに行けない」ことは
    // `null` と区別できず、規則7 と同じ結末が一貫する。
    const httpFetch = new FixedHttpFetch(listed(carrot));
    const rejecting = async (): Promise<string | null> => {
      throw new Error('セッションを取り出せない');
    };

    await expect(listing(httpFetch, rejecting)()).resolves.toEqual({ outcome: 'failed' });
  });
});
