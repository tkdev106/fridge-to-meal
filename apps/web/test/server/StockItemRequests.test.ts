import { describe, expect, it } from 'vitest';
import type {
  RegisterStockItemInput,
  StockItemDto,
  UpdateStockItemInput,
} from '@fridge-to-meal/contract';
import type {
  DeleteStockItem,
  ListStockItems,
  RegisterStockItem,
  StockItemsOutcome,
  UpdateStockItem,
} from '../../src/server/StockItemRequests.js';
import {
  deleteStockItem,
  listStockItems,
  registerStockItem,
  updateStockItem,
} from '../../src/server/StockItemRequests.js';
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
 * 出た要求がちょうど1つであることを確かめて取り出す。**要求の中身（ヘッダ・method・本体）を
 * 見るものだけが使う** — 要求の件数そのものを仕様にするのは規則7 の1件だけである
 * （`docs/testing.md` 2章）。
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

// ---- 在庫の登録（B-24）----

/**
 * 登録の入力の標本。**任意の2欄が埋まっているものと `null` のものを用意する** —
 * 継ぎ目が欄を落としたり `null` を省略に読み替えたりしないことを見るため（規則2）。
 */
const carrotInput: RegisterStockItemInput = {
  name: 'にんじん',
  amount: '2本',
  expiryDate: '2026-09-21',
};
const porkInput: RegisterStockItemInput = { name: 'ぶたにく', amount: null, expiryDate: null };

/** 通る応答。**登録の成功は 201 だが、継ぎ目が読むのは `ok` だけである**（設計 5章 `HttpResponse`）。 */
const registered = { ok: true, body: {} } as const;

/** 断りの応答。載るのは `rule` だけである（`ErrorResponseDto` / ADR-032 決定3）。 */
function rejected(rule: string) {
  return { ok: false, body: { rule } } as const;
}

/**
 * 登録の口を1つ組む。本題（届ける応答・トークンの取り出し方）だけが引数に現れる形にする
 * （`docs/testing.md` 6章）。**空文字の `baseUrl` は組む側の話なのでここでは扱わない**（設計 10章）。
 */
function registering(
  httpFetch: FixedHttpFetch,
  accessTokenOf: () => Promise<string | null> = async () => accessToken,
): RegisterStockItem {
  return registerStockItem({ baseUrl, accessToken: accessTokenOf, httpFetch: httpFetch.httpFetch });
}

describe('在庫の登録 registerStockItem', () => {
  it('応答が通れば registered の結末を返す', async () => {
    // FR-01: 保存できたことだけを伝える。**応答の在庫品は結末に載せない** —
    // 一覧はサーバから取り直す（`App.tsx`）ので、受け取っても使い道が無い。
    const outcome = await registering(new FixedHttpFetch(registered))(carrotInput);

    expect(outcome).toEqual({ outcome: 'registered' });
  });

  it('叩く先は基点に /stock-items を足した1つだけで世帯を表すものを載せない', async () => {
    // B-22 設計 規則6・15 / C-9 / NFR-09: 接頭辞を web の側で足さない。世帯は経路にも
    // クエリにも本体にも載せず、サーバがアクセストークンから定める。
    const httpFetch = new FixedHttpFetch(registered);

    await registering(httpFetch)(carrotInput);

    expect(httpFetch.receivedRequests.map((request) => request.url)).toEqual([
      'https://api.example.dev/stock-items',
    ]);
  });

  it('POST で送る', async () => {
    // FR-01 / B-09: 登録の経路は `POST /stock-items` である（同じ経路の `GET` は一覧を返す）。
    const httpFetch = new FixedHttpFetch(registered);

    await registering(httpFetch)(carrotInput);

    expect(onlyRequest(httpFetch).method).toBe('POST');
  });

  it('渡された登録の入力をそのまま JSON にして本体に載せる', async () => {
    // B-22 設計 規則2 / C-9: 詰め替えない。未設定の欄は `null` のまま送り、省略に読み替えない
    // （contract は省略と `null` を同義と定めるが、**読み替えるのは継ぎ目の仕事ではない**）。
    // 期待値は literal で置く（`docs/testing.md` 3章）。
    const httpFetch = new FixedHttpFetch(registered);

    await registering(httpFetch)(porkInput);

    expect(onlyRequest(httpFetch).body).toBe('{"name":"ぶたにく","amount":null,"expiryDate":null}');
  });

  it('取り出したアクセストークンを Authorization の Bearer に載せる', async () => {
    // B-22 設計 規則8 / ADR-043: トークンはヘッダで運ぶ（Cookie の経路を作らない）。
    const httpFetch = new FixedHttpFetch(registered);

    await registering(httpFetch)(carrotInput);

    expect(onlyRequest(httpFetch).headers.Authorization).toBe('Bearer access-token-example');
  });

  it('本体を持つので Content-Type に application/json を付ける', async () => {
    // B-24: `GET` では付けなかった（規則8）が、本体を読ませる要求には要る。CORS の許可は
    // `Authorization` と `Content-Type` の2つで、api 側に既に入っている（ADR-048 / `main.ts`）。
    // **付けるのはこの2つだけである** — 増やすと preflight の許可対象が増える。
    const httpFetch = new FixedHttpFetch(registered);

    await registering(httpFetch)(carrotInput);

    expect(onlyRequest(httpFetch).headers).toEqual({
      Authorization: 'Bearer access-token-example',
      'Content-Type': 'application/json',
    });
  });

  it('アクセストークンが null なら failed の結末を返す', async () => {
    // B-22 設計 規則7 / 7章: 出しても 401 が返るだけである。
    const outcome = await registering(
      new FixedHttpFetch(registered),
      async () => null,
    )(carrotInput);

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('アクセストークンが null なら要求を1つも出さない', async () => {
    // B-22 設計 規則7: **出さないこと自体が要件**（`docs/testing.md` 2章の例外）。
    // **通る応答を用意しておく** — 誤って出た回も最後まで通り、落ちるのは件数の断定だけになる。
    const httpFetch = new FixedHttpFetch(registered);

    await registering(httpFetch, async () => null)(carrotInput);

    expect(httpFetch.receivedRequests.map((request) => request.url)).toEqual([]);
  });

  it('アクセストークンが空文字でも要求を出し空のまま Bearer に載せる', async () => {
    // B-22 設計 規則7 後半: 「提示されていない」の判定は api と `IdentifyHousehold` の側に
    // 1か所だけ残す。web で null と同じに畳まない。
    const httpFetch = new FixedHttpFetch(registered);

    await registering(httpFetch, async () => '')(carrotInput);

    expect(onlyRequest(httpFetch).headers.Authorization).toBe('Bearer ');
  });

  it('断りの応答の rule をそのまま rejected の結末に載せる', async () => {
    // ADR-032 決定3 / B-24: **読み込みと違い失敗を1つに畳まない** — 登録には利用者が入力を
    // 直せば通る断りがあり（`name.empty` / `expiryDate.*`）、畳むとそれを伝えられない。
    // **どの rule を「直せる誤り」と読むかは画面が決める**（`RegisterFailureNotice.ts`）ので、
    // ここは値をそのまま運ぶ。
    const outcome = await registering(new FixedHttpFetch(rejected('expiryDate.format')))(
      carrotInput,
    );

    expect(outcome).toEqual({ outcome: 'rejected', rule: 'expiryDate.format' });
  });

  it('断りの応答に rule が無ければ failed の結末を返す', async () => {
    // B-22 設計 規則9 と同じ構え: 選ぶ手がかりの無い断りは、理由の無い失敗と変わらない。
    const outcome = await registering(new FixedHttpFetch({ ok: false, body: {} }))(carrotInput);

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('断りの応答の rule が文字列でなければ failed の結末を返す', async () => {
    // B-22 設計 規則9: 文字列でないものを画面に渡すと、文言の選び分けの側で落ちる。
    const outcome = await registering(new FixedHttpFetch({ ok: false, body: { rule: 42 } }))(
      carrotInput,
    );

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('断りの応答の本体が読めなければ failed の結末を返す', async () => {
    // B-22 設計 規則9 / 7章: 本体が読めないことも1つの結末に畳む。
    const outcome = await registering(new FixedHttpFetch({ ok: false, unreadableBody: true }))(
      carrotInput,
    );

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('通った応答の本体が読めなくても registered の結末を返す', async () => {
    // B-24: **成功の本体は読まない。** 一覧はサーバから取り直すため、採番された識別子を
    // 受け取っても使い道が無い（使う周が来たら読む）。
    const outcome = await registering(new FixedHttpFetch({ ok: true, unreadableBody: true }))(
      carrotInput,
    );

    expect(outcome).toEqual({ outcome: 'registered' });
  });

  it('通信が失敗して出口が投げても例外を外に出さず failed の結末を返す', async () => {
    // B-22 設計 規則9 / FR-41: 外へ出すと画面の側で誰も受け止めず、送っている表示のまま止まる。
    const httpFetch = new FixedHttpFetch({ throws: new Error('送れない') });

    await expect(registering(httpFetch)(carrotInput)).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンの取り出しが投げても例外を外に出さず failed の結末を返す', async () => {
    // B-22 設計 規則9 / `Session.ts` 規則7: `SessionImpl.accessToken` は投げうる。
    const httpFetch = new FixedHttpFetch(registered);
    const rejecting = async (): Promise<string | null> => {
      throw new Error('セッションを取り出せない');
    };

    await expect(registering(httpFetch, rejecting)(carrotInput)).resolves.toEqual({
      outcome: 'failed',
    });
  });

  it('1度断られても自分では送り直さない', async () => {
    // ADR-007 / B-12 設計 規則7: 自動で送り直すと、**同名でも統合されない在庫品が2件残る。**
    // 2度目の応答が結果に現れないことで見る（**回数は数えない**）。
    const httpFetch = new FixedHttpFetch({ throws: new Error('送れない') }, registered);

    const outcome = await registering(httpFetch)(carrotInput);

    expect(outcome).toEqual({ outcome: 'failed' });
  });
});

// ---- 在庫の削除（B-23）----

/** 削除する在庫品の識別子の標本。**一覧から渡ってくる値であり、web は形を決めない**（ADR-026）。 */
const carrotId = 'stock-item-carrot';

/**
 * 通る応答。**削除の成功は 204 で本体を持たない**ため、本体が読めない応答として届ける —
 * 継ぎ目が読むのは `ok` だけである（設計 5章 `HttpResponse`）。
 */
const deleted = { ok: true, unreadableBody: true } as const;

/**
 * 削除の口を1つ組む。本題（届ける応答・トークンの取り出し方）だけが引数に現れる形にする
 * （`docs/testing.md` 6章）。
 */
function deleting(
  httpFetch: FixedHttpFetch,
  accessTokenOf: () => Promise<string | null> = async () => accessToken,
): DeleteStockItem {
  return deleteStockItem({ baseUrl, accessToken: accessTokenOf, httpFetch: httpFetch.httpFetch });
}

describe('在庫の削除 deleteStockItem', () => {
  it('応答が通れば deleted の結末を返す', async () => {
    // FR-06: 消えたことだけを伝える。204 は本体を持たないので読まない。
    const outcome = await deleting(new FixedHttpFetch(deleted))(carrotId);

    expect(outcome).toEqual({ outcome: 'deleted' });
  });

  it('叩く先は基点に /stock-items と識別子を足した1つだけで世帯を表すものを載せない', async () => {
    // B-22 設計 規則6・15 / C-9 / NFR-09: 接頭辞を web の側で足さない。世帯は経路にも
    // クエリにも載せず、サーバがアクセストークンから定める。
    const httpFetch = new FixedHttpFetch(deleted);

    await deleting(httpFetch)(carrotId);

    expect(httpFetch.receivedRequests.map((request) => request.url)).toEqual([
      'https://api.example.dev/stock-items/stock-item-carrot',
    ]);
  });

  it('識別子に経路の区切りが混ざっても1つの区切りとして送る', async () => {
    // ADR-026 / B-23: 識別子の形を決めるのは発行する側であり、web は検めない。**経路へ
    // 埋めるときだけは逃がす** — 逃がさないと、一覧から渡った値で別の経路を叩く形になる。
    const httpFetch = new FixedHttpFetch(deleted);

    await deleting(httpFetch)('stock-item/../health');

    expect(httpFetch.receivedRequests.map((request) => request.url)).toEqual([
      'https://api.example.dev/stock-items/stock-item%2F..%2Fhealth',
    ]);
  });

  it('DELETE で送る', async () => {
    // FR-06 / B-09: 削除の経路は `DELETE /stock-items/:id` である。
    const httpFetch = new FixedHttpFetch(deleted);

    await deleting(httpFetch)(carrotId);

    expect(onlyRequest(httpFetch).method).toBe('DELETE');
  });

  it('本体を持たないので Content-Type を付けない', async () => {
    // B-22 設計 規則8 / ADR-048: 付けると preflight の許可対象が増える。削除に本体は無い。
    const httpFetch = new FixedHttpFetch(deleted);

    await deleting(httpFetch)(carrotId);

    expect(onlyRequest(httpFetch).headers).toEqual({
      Authorization: 'Bearer access-token-example',
    });
  });

  it('本体を1つも送らない', async () => {
    // B-23: 消す相手は経路の識別子で足りる。本体を付けると、api 側が読まないものを運ぶことになる。
    const httpFetch = new FixedHttpFetch(deleted);

    await deleting(httpFetch)(carrotId);

    expect(onlyRequest(httpFetch).body).toBeUndefined();
  });

  it('取り出したアクセストークンを Authorization の Bearer に載せる', async () => {
    // B-22 設計 規則8 / ADR-043: トークンはヘッダで運ぶ（Cookie の経路を作らない）。
    const httpFetch = new FixedHttpFetch(deleted);

    await deleting(httpFetch)(carrotId);

    expect(onlyRequest(httpFetch).headers.Authorization).toBe('Bearer access-token-example');
  });

  it('アクセストークンが null なら failed の結末を返す', async () => {
    // B-22 設計 規則7 / 7章: 出しても 401 が返るだけである。
    const outcome = await deleting(new FixedHttpFetch(deleted), async () => null)(carrotId);

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('アクセストークンが null なら要求を1つも出さない', async () => {
    // B-22 設計 規則7: **出さないこと自体が要件**（`docs/testing.md` 2章の例外）。
    // **通る応答を用意しておく** — 誤って出た回も最後まで通り、落ちるのは件数の断定だけになる。
    const httpFetch = new FixedHttpFetch(deleted);

    await deleting(httpFetch, async () => null)(carrotId);

    expect(httpFetch.receivedRequests.map((request) => request.url)).toEqual([]);
  });

  it('アクセストークンが空文字でも要求を出し空のまま Bearer に載せる', async () => {
    // B-22 設計 規則7 後半: 「提示されていない」の判定は api と `IdentifyHousehold` の側に
    // 1か所だけ残す。web で null と同じに畳まない。
    const httpFetch = new FixedHttpFetch(deleted);

    await deleting(httpFetch, async () => '')(carrotId);

    expect(onlyRequest(httpFetch).headers.Authorization).toBe('Bearer ');
  });

  it('見つからない断りの rule もそのまま rejected の結末に載せる', async () => {
    // ADR-027 / B-23: **継ぎ目は `delete.notFound` を成功に畳まない。** 「すでに消えている」と
    // 読むかどうかは画面の判断であり（`DeleteFailureNotice.ts`）、ここは値を運ぶだけである
    // （`server/README.md`「`rule` から文言を選ばない」）。
    const outcome = await deleting(new FixedHttpFetch(rejected('delete.notFound')))(carrotId);

    expect(outcome).toEqual({ outcome: 'rejected', rule: 'delete.notFound' });
  });

  it('認証の断りの rule もそのまま rejected の結末に載せる', async () => {
    // ADR-032 決定3: 継ぎ目は `rule` の意味を読まない。401 の断り（`accessToken.missing`）も
    // 同じ形で運び、読み分けは画面に任せる。
    const outcome = await deleting(new FixedHttpFetch(rejected('accessToken.missing')))(carrotId);

    expect(outcome).toEqual({ outcome: 'rejected', rule: 'accessToken.missing' });
  });

  it('断りの応答に rule が無ければ failed の結末を返す', async () => {
    // B-22 設計 規則9 と同じ構え: 読む手がかりの無い断りは、理由の無い失敗と変わらない。
    const outcome = await deleting(new FixedHttpFetch({ ok: false, body: {} }))(carrotId);

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('断りの応答の rule が文字列でなければ failed の結末を返す', async () => {
    // B-22 設計 規則9: 文字列でないものを画面に渡すと、読み分けの側で落ちる。
    const outcome = await deleting(new FixedHttpFetch({ ok: false, body: { rule: 42 } }))(carrotId);

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('断りの応答の本体が読めなければ failed の結末を返す', async () => {
    // B-22 設計 規則9 / 7章: 本体が読めないことも1つの結末に畳む。**通った応答と違い、
    // 断りは本体を読む** — `rule` が無ければ画面は何も読み分けられない。
    const outcome = await deleting(new FixedHttpFetch({ ok: false, unreadableBody: true }))(
      carrotId,
    );

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('通信が失敗して出口が投げても例外を外に出さず failed の結末を返す', async () => {
    // B-22 設計 規則9 / FR-41: 外へ出すと画面の側で誰も受け止めず、一覧が止まる。
    const httpFetch = new FixedHttpFetch({ throws: new Error('送れない') });

    await expect(deleting(httpFetch)(carrotId)).resolves.toEqual({ outcome: 'failed' });
  });

  it('アクセストークンの取り出しが投げても例外を外に出さず failed の結末を返す', async () => {
    // B-22 設計 規則9 / `Session.ts` 規則7: `SessionImpl.accessToken` は投げうる。
    const httpFetch = new FixedHttpFetch(deleted);
    const rejecting = async (): Promise<string | null> => {
      throw new Error('セッションを取り出せない');
    };

    await expect(deleting(httpFetch, rejecting)(carrotId)).resolves.toEqual({ outcome: 'failed' });
  });

  it('1度失敗しても自分では送り直さない', async () => {
    // ADR-007 / ADR-027 / B-23: 削除は冪等でないため、**送り直した2度目は消せていても 404 を
    // 受け取る。** 再送は利用者の操作に委ねる（`docs/screen-design.md` 5章は確認も取り消しも
    // 置いていない）。2度目の応答が結果に現れないことで見る（**回数は数えない**）。
    const httpFetch = new FixedHttpFetch({ throws: new Error('送れない') }, deleted);

    const outcome = await deleting(httpFetch)(carrotId);

    expect(outcome).toEqual({ outcome: 'failed' });
  });
});

// ---- 在庫の更新（B-55）----

/**
 * 更新の入力の標本。**任意の2欄のうち一方を `null` にする** — 継ぎ目が欄を落としたり
 * `null` を省略に読み替えたりしないことを見るため（B-22 設計 規則2 / B-55 規則12・14）。
 */
const carrotUpdate: UpdateStockItemInput = { amount: '3本', expiryDate: null };

/** 通る応答。**更新の成功は 200 だが、継ぎ目が読むのは `ok` だけである**（B-55 規則14）。 */
const updated = { ok: true, body: {} } as const;

/**
 * 更新の口を1つ組む。本題（届ける応答・トークンの取り出し方）だけが引数に現れる形にする
 * （`docs/testing.md` 6章）。
 */
function updating(
  httpFetch: FixedHttpFetch,
  accessTokenOf: () => Promise<string | null> = async () => accessToken,
): UpdateStockItem {
  return updateStockItem({ baseUrl, accessToken: accessTokenOf, httpFetch: httpFetch.httpFetch });
}

describe('在庫の更新 updateStockItem', () => {
  it('応答が通れば updated の結末を返す', async () => {
    // FR-05 / B-55 規則14: 書き換えられたことだけを伝える。**応答の在庫品は結末に載せない** —
    // 一覧はサーバから取り直す（規則9）ので、受け取っても使い道が無い。
    const outcome = await updating(new FixedHttpFetch(updated))(carrotId, carrotUpdate);

    expect(outcome).toEqual({ outcome: 'updated' });
  });

  it('叩く先は基点に /stock-items と識別子を足した1つだけで世帯を表すものを載せない', async () => {
    // B-55 規則13 / C-9 / NFR-09: 接頭辞を web の側で足さない。世帯は経路にもクエリにも
    // 本体にも載せず、サーバがアクセストークンから定める。
    const httpFetch = new FixedHttpFetch(updated);

    await updating(httpFetch)('stock-item-carrot', carrotUpdate);

    expect(httpFetch.receivedRequests.map((request) => request.url)).toEqual([
      'https://api.example.dev/stock-items/stock-item-carrot',
    ]);
  });

  it('識別子に経路の区切りが混ざっても1つの区切りとして送る', async () => {
    // ADR-026 / B-55 規則13: 識別子の形を決めるのは発行する側であり、web は検めない。
    // **経路へ埋めるときだけは逃がす** — 逃がさないと、行から渡った値で別の経路を叩く形になる。
    const httpFetch = new FixedHttpFetch(updated);

    await updating(httpFetch)('a/b?c', carrotUpdate);

    expect(httpFetch.receivedRequests.map((request) => request.url)).toEqual([
      'https://api.example.dev/stock-items/a%2Fb%3Fc',
    ]);
  });

  it('PUT で送る', async () => {
    // FR-05 / B-09: 更新の経路は `PUT /stock-items/:id` である。
    const httpFetch = new FixedHttpFetch(updated);

    await updating(httpFetch)(carrotId, carrotUpdate);

    expect(onlyRequest(httpFetch).method).toBe('PUT');
  });

  it('渡された更新の入力をそのまま JSON にして本体に載せる', async () => {
    // B-55 規則12 / FR-13: 詰め替えない。空欄を `null` に倒すのは画面の側
    // （`StockItemFormValues.ts`）であり、継ぎ目は運ぶだけである。**省略に読み替えない** —
    // `UpdateStockItemInput` は常に置き換えとして扱う。期待値は literal で置く。
    const httpFetch = new FixedHttpFetch(updated);

    await updating(httpFetch)(carrotId, carrotUpdate);

    expect(onlyRequest(httpFetch).body).toBe('{"amount":"3本","expiryDate":null}');
  });

  it('取り出したアクセストークンを Authorization の Bearer に載せる', async () => {
    // B-22 設計 規則8 / ADR-043: トークンはヘッダで運ぶ（Cookie の経路を作らない）。
    const httpFetch = new FixedHttpFetch(updated);

    await updating(httpFetch)(carrotId, carrotUpdate);

    expect(onlyRequest(httpFetch).headers.Authorization).toBe('Bearer access-token-example');
  });

  it('本体を持つので Content-Type に application/json を付ける', async () => {
    // B-55 設計 9章 / ADR-048: 付けるのは `Authorization` と `Content-Type` の2つだけである
    // （api 側の `ALLOWED_HEADERS` に既にある）— 増やすと preflight の許可対象が増える。
    const httpFetch = new FixedHttpFetch(updated);

    await updating(httpFetch)(carrotId, carrotUpdate);

    expect(onlyRequest(httpFetch).headers).toEqual({
      Authorization: 'Bearer access-token-example',
      'Content-Type': 'application/json',
    });
  });

  it('アクセストークンが null なら failed の結末を返す', async () => {
    // B-22 設計 規則7 / B-55 7章: 出しても 401 が返るだけである。
    const outcome = await updating(new FixedHttpFetch(updated), async () => null)(
      carrotId,
      carrotUpdate,
    );

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('アクセストークンが null なら要求を1つも出さない', async () => {
    // B-22 設計 規則7: **出さないこと自体が要件**（`docs/testing.md` 2章の例外）。
    // **通る応答を用意しておく** — 誤って出た回も最後まで通り、落ちるのは件数の断定だけになる。
    const httpFetch = new FixedHttpFetch(updated);

    await updating(httpFetch, async () => null)(carrotId, carrotUpdate);

    expect(httpFetch.receivedRequests.map((request) => request.url)).toEqual([]);
  });

  it('アクセストークンが空文字でも要求を出し空のまま Bearer に載せる', async () => {
    // B-22 設計 規則7 後半: 「提示されていない」の判定は api と `IdentifyHousehold` の側に
    // 1か所だけ残す。web で null と同じに畳まない。
    const httpFetch = new FixedHttpFetch(updated);

    await updating(httpFetch, async () => '')(carrotId, carrotUpdate);

    expect(onlyRequest(httpFetch).headers.Authorization).toBe('Bearer ');
  });

  it('見つからない断りの rule をそのまま rejected の結末に載せる', async () => {
    // ADR-050 結果5 / B-55 規則10・12: **継ぎ目は `update.notFound` を成功にも失敗にも
    // 畳まない。** 「消えている」と読まずに案内を出すのは画面の判断であり
    // （`UpdateFailureNotice.ts`）、ここは値を運ぶだけである。
    const outcome = await updating(new FixedHttpFetch(rejected('update.notFound')))(
      carrotId,
      carrotUpdate,
    );

    expect(outcome).toEqual({ outcome: 'rejected', rule: 'update.notFound' });
  });

  it('表に無い rule も読まずにそのまま rejected の結末に載せる', async () => {
    // ADR-032 決定3 / B-55 規則12: 継ぎ目は `rule` の意味を読まない。401 の断り
    // （`accessToken.missing`）も同じ形で運び、読み分けは画面に任せる。
    const outcome = await updating(new FixedHttpFetch(rejected('accessToken.missing')))(
      carrotId,
      carrotUpdate,
    );

    expect(outcome).toEqual({ outcome: 'rejected', rule: 'accessToken.missing' });
  });

  it('断りの応答に rule が無ければ failed の結末を返す', async () => {
    // B-22 設計 規則9 と同じ構え: 読む手がかりの無い断りは、理由の無い失敗と変わらない。
    const outcome = await updating(new FixedHttpFetch({ ok: false, body: { message: '断る' } }))(
      carrotId,
      carrotUpdate,
    );

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('断りの応答の rule が文字列でなければ failed の結末を返す', async () => {
    // B-22 設計 規則9: 文字列でないものを画面に渡すと、案内の選び分けの側で落ちる。
    const outcome = await updating(new FixedHttpFetch({ ok: false, body: { rule: 1 } }))(
      carrotId,
      carrotUpdate,
    );

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('断りの応答の本体が読めなければ failed の結末を返す', async () => {
    // B-22 設計 規則9 / B-55 7章: 本体が読めないことも1つの結末に畳む。**通った応答と違い、
    // 断りは本体を読む** — `rule` が無ければ画面は何も読み分けられない。
    const outcome = await updating(new FixedHttpFetch({ ok: false, unreadableBody: true }))(
      carrotId,
      carrotUpdate,
    );

    expect(outcome).toEqual({ outcome: 'failed' });
  });

  it('通った応答の本体が読めなくても updated の結末を返す', async () => {
    // B-55 規則14: **成功の本体は読まない。** 使い道が無く、読めない本体で成功を失敗に
    // 化けさせる理由も無い。
    const outcome = await updating(new FixedHttpFetch({ ok: true, unreadableBody: true }))(
      carrotId,
      carrotUpdate,
    );

    expect(outcome).toEqual({ outcome: 'updated' });
  });

  it('通信が失敗して出口が投げても例外を外に出さず failed の結末を返す', async () => {
    // B-22 設計 規則9 / FR-41: 外へ出すと画面の側で誰も受け止めず、送っている表示のまま
    // 止まる（B-55 規則7 が保存も「←」も止めているため、閉じられなくなる）。
    const httpFetch = new FixedHttpFetch({ throws: new Error('送れない') });

    await expect(updating(httpFetch)(carrotId, carrotUpdate)).resolves.toEqual({
      outcome: 'failed',
    });
  });

  it('アクセストークンの取り出しが投げても例外を外に出さず failed の結末を返す', async () => {
    // B-22 設計 規則9 / `Session.ts` 規則7: `SessionImpl.accessToken` は投げうる。
    const httpFetch = new FixedHttpFetch(updated);
    const rejecting = async (): Promise<string | null> => {
      throw new Error('セッションを取り出せない');
    };

    await expect(updating(httpFetch, rejecting)(carrotId, carrotUpdate)).resolves.toEqual({
      outcome: 'failed',
    });
  });

  it('1度断られても自分では送り直さない', async () => {
    // B-55 規則12 / ADR-007: 断られた回に送り直しても、利用者が入力を直さない限り同じ断りが
    // 返る（`update.notFound` なら相手は消えている）。再送は利用者の操作に委ねる。
    // 2度目の応答が結果に現れないことで見る（**回数は数えない**。先行の登録・削除と同じ）。
    const httpFetch = new FixedHttpFetch(rejected('update.notFound'), updated);

    const outcome = await updating(httpFetch)(carrotId, carrotUpdate);

    expect(outcome).toEqual({ outcome: 'rejected', rule: 'update.notFound' });
  });
});
