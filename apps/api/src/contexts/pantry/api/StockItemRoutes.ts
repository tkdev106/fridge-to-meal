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
import { logUnexpectedFailure } from '../../../shared/api/UnexpectedFailureLog.js';

/** 世帯は**中身を見ない値**として扱う。型はユースケースから引く（ADR-032 の決定1）。 */
type HouseholdIdParam = Parameters<ListStockItems>[0];

/** 在庫品の識別子も同じく導出する。経路の `:id` をこの型として渡す（ADR-032 の決定1）。 */
type StockItemIdParam = Parameters<DeleteStockItem>[1];

export type StockItemRoutesDeps = {
  identifyHousehold: (accessToken: string) => Promise<HouseholdIdParam>;
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
  const determineHousehold = async (
    authorizationHeader: string | undefined,
  ): Promise<HouseholdIdParam> =>
    await deps.identifyHousehold(extractAccessToken(authorizationHeader));

  routes.post('/stock-items', async (c) => {
    try {
      // 世帯を定めるのが常に先（規則5 / NFR-09）。**本体を読むのは認証を通ったあと**である —
      // 認証を通らない呼び出しに、本体の検証結果を返さない。
      const household = await determineHousehold(c.req.header('Authorization'));

      const body = await readBody(c);
      if ('rejection' in body) return c.json(body.rejection, 400);

      const parsedInput = toRegisterStockItemInput(body.parsed);
      if ('rejection' in parsedInput) return c.json(parsedInput.rejection, 400);

      // 世帯は必ず第1引数（C-9）。要求本体の `householdId` は見ない（規則2）。
      const registeredStockItem = await deps.registerStockItem(household, parsedInput.input);

      return c.json(registeredStockItem, 201);
    } catch (thrown) {
      return reject(c, thrown);
    }
  });

  routes.get('/stock-items', async (c) => {
    try {
      const household = await determineHousehold(c.req.header('Authorization'));

      // クエリから世帯を読める道を作らない（規則2 / C-9）。並びはユースケースのものを
      // 保ったまま返す（規則12）。
      const output: ListStockItemsOutput = await deps.listStockItems(household);

      return c.json(output, 200);
    } catch (thrown) {
      return reject(c, thrown);
    }
  });

  routes.put('/stock-items/:id', async (c) => {
    try {
      const household = await determineHousehold(c.req.header('Authorization'));

      const body = await readBody(c);
      if ('rejection' in body) return c.json(body.rejection, 400);

      const parsedInput = toUpdateStockItemInput(body.parsed);
      if ('rejection' in parsedInput) return c.json(parsedInput.rejection, 400);

      // 経路の `:id` は加工せずそのまま識別子として渡す（規則11 / ADR-032 の結果1）。
      // 書式も長さも見ない — 形を決めるのは識別子を発行する側である（ADR-026）。
      const stockItemId = c.req.param('id') as StockItemIdParam;

      const updatedStockItem = await deps.updateStockItem(
        household,
        stockItemId,
        parsedInput.input,
      );

      return c.json(updatedStockItem, 200);
    } catch (thrown) {
      return reject(c, thrown);
    }
  });

  routes.delete('/stock-items/:id', async (c) => {
    try {
      const household = await determineHousehold(c.req.header('Authorization'));

      const stockItemId = c.req.param('id') as StockItemIdParam;

      // 削除は冪等でない（規則13 / ADR-027）。2度目は `delete.notFound` が投げられ、
      // 下の写像で 404 になる。
      await deps.deleteStockItem(household, stockItemId);

      // 204 は本体を持てない（規則6）。`c.json` では本体が付いてしまう。
      return c.body(null, 204);
    } catch (thrown) {
      return reject(c, thrown);
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
function reject(c: Context, thrown: unknown) {
  const mappedError = statusOfThrown(thrown);
  if (mappedError !== null) return c.json(mappedError.body, mappedError.status);

  // 応答には原因を出さない代わりに、サーバのログにだけ種類を残す（ADR-080）。
  logUnexpectedFailure(thrown);
  return c.json({ rule: 'unexpected' } satisfies ErrorResponseDto, 500);
}

/**
 * 要求の本体を読む。**読めなかったことを例外にせず、断る応答として返す**
 * （設計書7章 表3）。ドメインの規則違反とは経路が違うので、`rule` は `request.` で始める。
 */
async function readBody(
  c: Context,
): Promise<{ parsed: unknown } | { rejection: ErrorResponseDto }> {
  try {
    return { parsed: (await c.req.json()) as unknown };
  } catch {
    return { rejection: { rule: 'request.notJson' } };
  }
}

/** 文字列・`null`・省略のいずれかか（`RegisterStockItemInput` の任意項目）。 */
const optionalNullableString = (value: unknown): boolean =>
  value === undefined || value === null || typeof value === 'string';

/** 文字列か `null` か（`UpdateStockItemInput`。**省略を許さない**）。 */
const nullableString = (value: unknown): boolean => value === null || typeof value === 'string';

/** 項目を読み出せる形か。配列も `null` もここで落ちる。 */
function toFields(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/**
 * 登録の本体の**形だけ**を見る（設計書 規則8）。
 *
 * 空の名称も期限の書式も前後の空白も見ない — それはドメインが持つ規則であり、
 * ここで二重に持つと同じ規則が2か所に増える（規則7 / B-04 規則7）。
 * 知らない項目は断らずに無視する（規則10）。`useForMeals` は省略も `null` も許さず、
 * 真偽値だけを通す（ADR-086）。
 */
function toRegisterStockItemInput(
  body: unknown,
): { input: RegisterStockItemInput } | { rejection: ErrorResponseDto } {
  const fields = toFields(body);
  if (fields === null) return { rejection: { rule: 'request.invalidBody' } };

  if (typeof fields.name !== 'string') return { rejection: { rule: 'request.invalidBody' } };
  if (
    !optionalNullableString(fields.ingredientId) ||
    !optionalNullableString(fields.amount) ||
    !optionalNullableString(fields.expiryDate) ||
    typeof fields.useForMeals !== 'boolean'
  ) {
    return { rejection: { rule: 'request.invalidBody' } };
  }

  // 読めた本体をそのまま渡す（規則1）。詰め替えると、知らない項目を落とすかどうかの
  // 判断がここに増える。
  return { input: body as RegisterStockItemInput };
}

/**
 * 更新の本体の形だけを見る（設計書 規則9）。**省略を許さない** —
 * 更新は常に置き換えであり、`null` が「消す」を表す（FR-13 / B-06 規則3）。
 * `useForMeals` は真偽値だけを通す（ADR-086）。
 */
function toUpdateStockItemInput(
  body: unknown,
): { input: UpdateStockItemInput } | { rejection: ErrorResponseDto } {
  const fields = toFields(body);
  if (fields === null) return { rejection: { rule: 'request.invalidBody' } };

  if (
    !nullableString(fields.amount) ||
    !nullableString(fields.expiryDate) ||
    typeof fields.useForMeals !== 'boolean'
  ) {
    return { rejection: { rule: 'request.invalidBody' } };
  }

  return { input: body as UpdateStockItemInput };
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
 *
 * **同じ規則の写しが献立と identity の側にある**（`meal/api/AccessToken.ts`。B-50b 設計書4章 /
 * `identity/api/AccessToken.ts`。B-75 設計書4章）。コンテキストをまたぐ api どうしの import は
 * 依存ルールが禁じるため1本にまとめられない — 規則を動かすときは3つとも変える。
 */
function extractAccessToken(authorizationHeader: string | undefined): string {
  if (authorizationHeader === undefined) return '';

  const separatorIndex = authorizationHeader.indexOf(' ');
  if (separatorIndex < 0) return '';

  const scheme = authorizationHeader.slice(0, separatorIndex);
  if (scheme.toLowerCase() !== 'bearer') return '';

  return authorizationHeader.slice(separatorIndex + 1);
}
