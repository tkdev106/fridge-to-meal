// 在庫品の4経路（FR-01 / FR-04 / FR-05 / FR-06）。
//
// 呼んでよいのは usecase だけであり、`domain/` も `shared/domain/` も `identity/` の何も
// import しない（ADR-003 / ADR-032）。世帯と在庫品の識別子の型はユースケースの
// シグネチャから導出し、`identifyHousehold` は関数として引数で受け取る。

import type {
  ErrorResponseDto,
  ListStockItemsOutput,
  RegisterStockItemInput,
  UpdateStockItemInput,
} from '@fridge-to-meal/contract';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { statusOfThrown } from './RuleViolationStatus.js';
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
 * 例外は `RuleViolationStatus` の表で状態コードに写す（規則14 / B-08 7章）。api 層が
 * 自分で断るもの（本体が読めない・形が合わない）は例外にせず、断る応答として返す。
 */
export function createStockItemRoutes(deps: StockItemRoutesDeps): Hono {
  // `new` してよいのは Hono だけである（ADR-002 / B-08 9章）。
  const routes = new Hono();

  // `Request` / `Response` / `Context` はハンドラの内側に閉じ、ユースケースには DTO と
  // 識別子だけを渡す（ADR-003 / B-08 9章）。ヘッダの値だけを取り出して委ねる。
  const 世帯を定める = async (認証ヘッダの値: string | undefined): Promise<世帯> =>
    await deps.identifyHousehold(アクセストークンを取り出す(認証ヘッダの値));

  routes.post('/stock-items', async (c) => {
    try {
      // 世帯を定めるのが常に先（規則5 / NFR-09）。**本体を読むのは認証を通ったあと**である —
      // 認証を通らない呼び出しに、本体の検証結果を返さない。
      const 世帯 = await 世帯を定める(c.req.header('Authorization'));

      const 本体 = await 本体を読む(c);
      if ('断る' in 本体) return c.json(本体.断る, 400);

      const 読んだ入力 = 登録の入力として読む(本体.読めた);
      if ('断る' in 読んだ入力) return c.json(読んだ入力.断る, 400);

      // 世帯は必ず第1引数（C-9）。要求本体の `householdId` は見ない（規則2）。
      const 登録された在庫品 = await deps.registerStockItem(世帯, 読んだ入力.入力);

      return c.json(登録された在庫品, 201);
    } catch (thrown) {
      return 断る(c, thrown);
    }
  });

  routes.get('/stock-items', async (c) => {
    try {
      const 世帯 = await 世帯を定める(c.req.header('Authorization'));

      // クエリから世帯を読める道を作らない（規則2 / C-9）。並びはユースケースのものを
      // 保ったまま返す（規則12）。
      const 出力: ListStockItemsOutput = await deps.listStockItems(世帯);

      return c.json(出力, 200);
    } catch (thrown) {
      return 断る(c, thrown);
    }
  });

  routes.put('/stock-items/:id', async (c) => {
    try {
      const 世帯 = await 世帯を定める(c.req.header('Authorization'));

      const 本体 = await 本体を読む(c);
      if ('断る' in 本体) return c.json(本体.断る, 400);

      const 読んだ入力 = 更新の入力として読む(本体.読めた);
      if ('断る' in 読んだ入力) return c.json(読んだ入力.断る, 400);

      // 経路の `:id` は加工せずそのまま識別子として渡す（規則11 / ADR-032 の結果1）。
      // 書式も長さも見ない — 形を決めるのは識別子を発行する側である（ADR-026）。
      const 識別子 = c.req.param('id') as 在庫品の識別子;

      const 更新後の在庫品 = await deps.updateStockItem(世帯, 識別子, 読んだ入力.入力);

      return c.json(更新後の在庫品, 200);
    } catch (thrown) {
      return 断る(c, thrown);
    }
  });

  routes.delete('/stock-items/:id', async (c) => {
    try {
      const 世帯 = await 世帯を定める(c.req.header('Authorization'));

      const 識別子 = c.req.param('id') as 在庫品の識別子;

      // 削除は冪等でない（規則13 / ADR-027）。2度目は `delete.notFound` が投げられ、
      // 下の写像で 404 になる。
      await deps.deleteStockItem(世帯, 識別子);

      // 204 は本体を持てない（規則6）。`c.json` では本体が付いてしまう。
      return c.body(null, 204);
    } catch (thrown) {
      return 断る(c, thrown);
    }
  });

  return routes;
}

/**
 * 投げられたものを応答に写す（設計書7章）。
 *
 * **写せない失敗は 500 の `unexpected` に畳み、`message` を本体に出さない**
 * （規則14 / NFR-09）— 接続文字列や設定の中身が応答に漏れる経路を作らない。
 */
function 断る(c: Context, thrown: unknown) {
  const 写した = statusOfThrown(thrown);
  if (写した !== null) return c.json(写した.body, 写した.status);

  return c.json({ rule: 'unexpected' } satisfies ErrorResponseDto, 500);
}

/**
 * 要求の本体を読む。**読めなかったことを例外にせず、断る応答として返す**
 * （設計書7章 表3）。ドメインの規則違反とは経路が違うので、`rule` は `request.` で始める。
 */
async function 本体を読む(c: Context): Promise<{ 読めた: unknown } | { 断る: ErrorResponseDto }> {
  try {
    return { 読めた: (await c.req.json()) as unknown };
  } catch {
    return { 断る: { rule: 'request.notJson' } };
  }
}

/** 文字列・`null`・省略のいずれかか（`RegisterStockItemInput` の任意項目）。 */
const 文字列かnullか省略 = (値: unknown): boolean =>
  値 === undefined || 値 === null || typeof 値 === 'string';

/** 文字列か `null` か（`UpdateStockItemInput`。**省略を許さない**）。 */
const 文字列かnull = (値: unknown): boolean => 値 === null || typeof 値 === 'string';

/** 項目を読み出せる形か。配列も `null` もここで落ちる。 */
function 項目の並びとして読む(本体: unknown): Record<string, unknown> | null {
  if (typeof 本体 !== 'object' || 本体 === null || Array.isArray(本体)) return null;
  return 本体 as Record<string, unknown>;
}

/**
 * 登録の本体の**形だけ**を見る（設計書 規則8）。
 *
 * 空の名称も期限の書式も前後の空白も見ない — それはドメインが持つ規則であり、
 * ここで二重に持つと同じ規則が2か所に増える（規則7 / B-04 規則7）。
 * 知らない項目は断らずに無視する（規則10）。
 */
function 登録の入力として読む(
  本体: unknown,
): { 入力: RegisterStockItemInput } | { 断る: ErrorResponseDto } {
  const 項目 = 項目の並びとして読む(本体);
  if (項目 === null) return { 断る: { rule: 'request.invalidBody' } };

  if (typeof 項目.name !== 'string') return { 断る: { rule: 'request.invalidBody' } };
  if (
    !文字列かnullか省略(項目.ingredientId) ||
    !文字列かnullか省略(項目.amount) ||
    !文字列かnullか省略(項目.expiryDate)
  ) {
    return { 断る: { rule: 'request.invalidBody' } };
  }

  // 読めた本体をそのまま渡す（規則1）。詰め替えると、知らない項目を落とすかどうかの
  // 判断がここに増える。
  return { 入力: 本体 as RegisterStockItemInput };
}

/**
 * 更新の本体の形だけを見る（設計書 規則9）。**省略を許さない** —
 * 更新は常に置き換えであり、`null` が「消す」を表す（FR-13 / B-06 規則3）。
 */
function 更新の入力として読む(
  本体: unknown,
): { 入力: UpdateStockItemInput } | { 断る: ErrorResponseDto } {
  const 項目 = 項目の並びとして読む(本体);
  if (項目 === null) return { 断る: { rule: 'request.invalidBody' } };

  if (!文字列かnull(項目.amount) || !文字列かnull(項目.expiryDate)) {
    return { 断る: { rule: 'request.invalidBody' } };
  }

  return { 入力: 本体 as UpdateStockItemInput };
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
