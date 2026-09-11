// 在庫品の4経路（FR-01 / FR-04 / FR-05 / FR-06）。
//
// 呼んでよいのは usecase だけであり、`domain/` も `shared/domain/` も `identity/` の何も
// import しない（ADR-003 / ADR-032）。世帯と在庫品の識別子の型はユースケースの
// シグネチャから導出し、`identifyHousehold` は関数として引数で受け取る。

import type { ListStockItemsOutput } from '@fridge-to-meal/contract';
import { Hono } from 'hono';
import type { DeleteStockItem } from '../usecase/DeleteStockItem.js';
import type { ListStockItems } from '../usecase/ListStockItems.js';
import type { RegisterStockItem } from '../usecase/RegisterStockItem.js';
import type { UpdateStockItem } from '../usecase/UpdateStockItem.js';

/** 世帯は**中身を見ない値**として扱う。型はユースケースから引く（ADR-032 の決定1）。 */
type 世帯 = Parameters<ListStockItems>[0];

/** 在庫品の識別子も同じく導出する。経路の `:id` をこの型として渡す（ADR-032 の決定1）。 */
type 在庫品の識別子 = Parameters<DeleteStockItem>[1];

export type StockItemRoutesDeps = {
  identifyHousehold: (accessToken: string) => Promise<世帯>;
  registerStockItem: RegisterStockItem;
  listStockItems: ListStockItems;
  updateStockItem: UpdateStockItem;
  deleteStockItem: DeleteStockItem;
};

/**
 * 在庫品の4経路を持つサブアプリを組み立てる。**接頭辞は付けない** — マウント先は B-09 が決める。
 *
 * 入出力は `packages/contract` の DTO そのままで、api で詰め替えも整形もしない（規則1 / ADR-003）。
 * 検査も正規化もここでは持たない — 空の名称も期限の書式も前後の空白もドメインが見る（規則7）。
 * 例外は素通りさせる。状態コードへの写像は表として別に持つ（規則14 / B-08 7章。2周目）。
 */
export function createStockItemRoutes(deps: StockItemRoutesDeps): Hono {
  // `new` してよいのは Hono だけである（ADR-002 / B-08 9章）。
  const routes = new Hono();

  // `Request` / `Response` / `Context` はハンドラの内側に閉じ、ユースケースには DTO と
  // 識別子だけを渡す（ADR-003 / B-08 9章）。ヘッダの値だけを取り出して委ねる。
  const 世帯を定める = async (認証ヘッダの値: string | undefined): Promise<世帯> =>
    await deps.identifyHousehold(アクセストークンを取り出す(認証ヘッダの値));

  routes.post('/stock-items', async (c) => {
    // 世帯を定めるのが常に先（規則5 / NFR-09）。本体を読むのは認証を通ったあとである。
    const 世帯 = await 世帯を定める(c.req.header('Authorization'));

    // 本体は読んだままユースケースへ渡す（規則1 / 規則7）。知らない項目も断らずに無視する
    // （規則10）— 断ると版の前後で登録が止まる。形の検査は 2周目（B-08 7章）。
    const 入力 = await c.req.json<Parameters<RegisterStockItem>[1]>();

    // 世帯は必ず第1引数（C-9）。要求本体の `householdId` は見ない（規則2）。
    const 登録された在庫品 = await deps.registerStockItem(世帯, 入力);

    return c.json(登録された在庫品, 201);
  });

  routes.get('/stock-items', async (c) => {
    const 世帯 = await 世帯を定める(c.req.header('Authorization'));

    // クエリから世帯を読める道を作らない（規則2 / C-9）。並びはユースケースのものを
    // 保ったまま返す（規則12）。
    const 出力: ListStockItemsOutput = await deps.listStockItems(世帯);

    return c.json(出力, 200);
  });

  routes.put('/stock-items/:id', async (c) => {
    const 世帯 = await 世帯を定める(c.req.header('Authorization'));

    // 経路の `:id` は加工せずそのまま識別子として渡す（規則11 / ADR-032 の結果1）。
    // 書式も長さも見ない — 形を決めるのは識別子を発行する側である（ADR-026）。
    const 識別子 = c.req.param('id') as 在庫品の識別子;
    const 入力 = await c.req.json<Parameters<UpdateStockItem>[2]>();

    const 更新後の在庫品 = await deps.updateStockItem(世帯, 識別子, 入力);

    return c.json(更新後の在庫品, 200);
  });

  routes.delete('/stock-items/:id', async (c) => {
    const 世帯 = await 世帯を定める(c.req.header('Authorization'));

    const 識別子 = c.req.param('id') as 在庫品の識別子;

    await deps.deleteStockItem(世帯, 識別子);

    // 204 は本体を持てない（規則6）。`c.json` では本体が付いてしまう。
    return c.body(null, 204);
  });

  return routes;
}

/**
 * `Authorization: Bearer <token>` からアクセストークンを取り出す（規則2 / NFR-09）。
 *
 * ヘッダが無い / 方式が `Bearer` でない / 値が空のとき、**api は独自に断らず空文字を渡す**
 * （規則3）。「提示されていない」の判定は `IdentifyHousehold` の1か所に残す — 2か所に
 * 置くと、断る条件が片方だけ動いた日に食い違う。方式名の照合は大小を区別しない。
 *
 * **区切りは最初の1空白**とし、残りは値の一部として渡す（規則4b）。連続する空白を
 * 区切りと読むと api が正規化を1つ持つことになり、正規化は腐敗防止層の仕事である（規則4）。
 */
function アクセストークンを取り出す(ヘッダの値: string | undefined): string {
  if (ヘッダの値 === undefined) return '';

  const 区切りの位置 = ヘッダの値.indexOf(' ');
  if (区切りの位置 < 0) return '';

  const 方式名 = ヘッダの値.slice(0, 区切りの位置);
  if (方式名.toLowerCase() !== 'bearer') return '';

  return ヘッダの値.slice(区切りの位置 + 1);
}
