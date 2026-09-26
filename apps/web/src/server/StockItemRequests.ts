/**
 * `GET /stock-items`（B-22 設計 5章 / 規則2・3・6〜10 / 7章）と `POST /stock-items`（B-24）、
 * `DELETE /stock-items/:id`（B-23）を叩く工場、および3つの結末。
 *
 * **ここは画面ではない。** 経路の継ぎ目であり、`@supabase/*` を1つも触らない —
 * トークンは `accessToken()` の1引数で受け取る（規則1 / ADR-046 決定3）。
 * **世帯は1つも運ばない**（C-9 / NFR-09）。
 */
import type {
  ErrorResponseDto,
  RegisterStockItemInput,
  StockItemDto,
  UpdateStockItemInput,
} from '@fridge-to-meal/contract';
import type { HttpFetch } from './HttpFetch.js';

/**
 * 読み込みの結末（設計 5章 / 規則9）。
 *
 * **失敗の種別を分けない** — `rule` も状態コードも読まない。**読み込みに限った判断である**
 * （登録の側は下の `RegisterStockItemOutcome` で分ける。ADR-032 決定3 / B-24）：一覧が取れない
 * 原因はどれも利用者の入力では直せず、画面に見分ける材料が無い。
 */
export type StockItemsOutcome =
  | { readonly outcome: 'loaded'; readonly stockItems: readonly StockItemDto[] }
  | { readonly outcome: 'failed' };

/** 画面が受け取る口。**この口は例外を投げない**（規則9）。 */
export type ListStockItems = () => Promise<StockItemsOutcome>;

/**
 * 登録の結末（B-24 / ADR-032 決定3）。
 *
 * **読み込みと違い、断られたことを失敗に畳まない。** 登録は利用者の入力から出た要求であり、
 * 断りの `rule` には**入力を直せば通るもの**が混ざる（`name.empty` / `expiryDate.format` /
 * `expiryDate.notACalendarDate`）。1つに畳むと、直せる誤りまで「もう一度お試しください」で
 * 流してしまう。手がかりの無い失敗（通信の失敗・`rule` の無い断り）は `failed` のままである。
 *
 * **`rule` をそのまま載せ、ここで文言を選ばない。** ADR-032 決定3 は「文言は載せない — 画面が
 * `rule` から選ぶ」と決めており、**ここは画面ではない**（`README.md`）。文言も配色も未確定で
 * （`docs/screen-design.md` 論点3）、選ぶ表を継ぎ目に置くと、画面の都合で継ぎ目が動くことになる。
 * どの `rule` を「直せる誤り」と読むかも同じ判断なので、表は画面の側にある
 * （`features/pantry/RegisterFailureNotice.ts`）。
 *
 * **成功に在庫品を載せないのは、使い道が無いためである。** 一覧はサーバから取り直す
 * （`App.tsx`）— web で列に足すと、並び（期限の近い順）を web が握り直すことになる（規則3）。
 */
export type RegisterStockItemOutcome =
  | { readonly outcome: 'registered' }
  | { readonly outcome: 'rejected'; readonly rule: string }
  | { readonly outcome: 'failed' };

/** 画面が受け取る口。**この口も例外を投げない**（規則9）。 */
export type RegisterStockItem = (
  input: RegisterStockItemInput,
) => Promise<RegisterStockItemOutcome>;

/**
 * 削除の結末（FR-06 / B-23 / ADR-050）。
 *
 * **登録と同じ3つの形を採る。** 断りの `rule` を畳まないのは、**`delete.notFound` を
 * 「すでに消えている」と読む判断が画面にある**ためである（ADR-027 が後続へ送った宿題を
 * ADR-050 が引き取った）。畳むと、その読み分けの材料がここで失われる。
 *
 * **ここでは読まない。** どの `rule` が来るかは api 層の写像が正であり（`RuleViolationStatus.ts`）、
 * 値の意味を読むのは画面である（`README.md` / `features/pantry/DeleteFailureNotice.ts`）。
 *
 * **成功に消した在庫品を載せない。** 応答は 204 で本体を持たず、一覧はサーバから取り直す
 * （`App.tsx`）— web で列から抜くと、並び（期限の近い順）を web が握り直すことになる（規則3）。
 */
export type DeleteStockItemOutcome =
  | { readonly outcome: 'deleted' }
  | { readonly outcome: 'rejected'; readonly rule: string }
  | { readonly outcome: 'failed' };

/**
 * 画面が受け取る口。**この口も例外を投げない**（規則9）。
 *
 * 受け取るのは在庫品の識別子だけで、**世帯は運ばない**（C-9）。識別子の形は検めない —
 * 形を決めるのは発行する側である（ADR-026）。
 */
export type DeleteStockItem = (id: string) => Promise<DeleteStockItemOutcome>;

export type StockItemRequestsDeps = {
  readonly baseUrl: string;
  /** `Session.accessToken` を渡す。継ぎ目の型そのものは受け取らない */
  readonly accessToken: () => Promise<string | null>;
  readonly httpFetch?: HttpFetch; // 既定は実行環境の fetch
};

/**
 * 叩く先は基点にこれを足した1つだけ（規則6・15）。**接頭辞を web の側で足さない** —
 * Worker は在庫の4経路を接頭辞なしで根に置いている（B-09）。
 */
const STOCK_ITEMS_PATH = '/stock-items';

/**
 * 畳んだ失敗はどれも同じ1つの結末である（規則9 / 7章）。**読み込みと登録で同じものを使う** —
 * 「手がかりが無い」という中身が同じであり、型もどちらの結末にも収まる。
 */
const FAILED = { outcome: 'failed' } as const;

/** 登録が通ったこと（B-24）。応答の在庫品は読まない（`RegisterStockItemOutcome` の doc）。 */
const REGISTERED = { outcome: 'registered' } as const;

/** 削除が通ったこと（B-23）。応答は 204 で本体を持たない（`DeleteStockItemOutcome` の doc）。 */
const DELETED = { outcome: 'deleted' } as const;

/**
 * 本体を持つ要求に付ける型（B-24）。**`GET` には付けない**（規則8）— 付けると preflight の
 * 許可対象が増える。api 側の CORS はこの2つ（`Authorization` と `Content-Type`）を既に
 * 許している（`apps/api/src/main.ts` の `ALLOWED_HEADERS` / ADR-048）。
 */
const JSON_CONTENT_TYPE = 'application/json';

/**
 * 既定の出口。**実行環境の `fetch` をそのまま使う**（設計 5章）。
 *
 * テストは `FixedHttpFetch` を渡すため、この既定はテストから観察されない。`HttpFetch` が
 * 構造型なので、`Response` の型を口に出さずに受け渡せる（`HttpFetch.ts` 冒頭）。
 */
const environmentHttpFetch: HttpFetch = (url, init) => fetch(url, init);

/**
 * 応答の本体のうち、この層が読む1項目だけ（規則9）。
 *
 * **要素の中身は検めない** — 相手は自分のサーバであり、contract の型で返す側が正である。
 * 検めを足すと web が第2の DTO を持つことになる（規則2）。そこでこの述語は
 * `stockItems` が配列であることまでしか見ず、要素の型は `StockItemDto` として受ける。
 */
function isListed(body: unknown): body is { readonly stockItems: readonly StockItemDto[] } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'stockItems' in body &&
    Array.isArray(body.stockItems)
  );
}

/**
 * 在庫一覧を取りに行く口を組む（規則6〜9）。
 *
 * **DTO を詰め替えない**（規則2）。**並べ替えない**（規則3）— サーバの並び（期限の近い順）を
 * そのまま渡す。
 *
 * **例外を外に出さない**（規則9）。トークンの取り出しが投げた・出口が投げた（オフライン・
 * 到達不能・CORS で塞がれた）・`ok` が偽（401 / 500）・本体が JSON として読めない・
 * `stockItems` が配列でない、のすべてを `failed` の1つに畳む。外へ出すと `App.tsx` の効果で
 * 誰も受け止めず、読み込み中のまま画面が止まる（FR-41）。
 *
 * **自分では取りに行き直さない**（規則10）— 呼ばれた1回で1往復だけする。
 *
 * **空文字の `baseUrl` を自分で断らない**（設計 10章）。組むのは `main.tsx` だけで、そこへ来る
 * 値は `apiBaseUrlOf` を通っており、規則5 が既に空を断っている。二重の門を置くと、断る責務が
 * どちらにあるか読めなくなる。
 */
export function listStockItems(deps: StockItemRequestsDeps): ListStockItems {
  const { baseUrl, accessToken, httpFetch = environmentHttpFetch } = deps;

  return async () => {
    try {
      const token = await accessToken();

      // 規則7: `null` なら**要求を出さない**。出しても 401 が返るだけで、往復を1つ無駄にする。
      // **空文字は `null` と同じに扱わず、そのまま `Bearer` に載せる** —
      // 「提示されていない」の判定は api と `IdentifyHousehold` の側に1か所だけ残す。
      if (token === null) {
        return FAILED;
      }

      // 規則8: 付けるヘッダは `Authorization` だけ。`GET` に本体は無いので `Content-Type` を
      // 付けない（付けると preflight の許可対象が増える。ADR-043）。
      const response = await httpFetch(`${baseUrl}${STOCK_ITEMS_PATH}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        return FAILED;
      }

      const body = await response.json();

      // 規則9: `stockItems` が無い本体を0件の `loaded` に倒さない —
      // **在庫があるのに無いように見せる**ことになる。
      return isListed(body) ? { outcome: 'loaded', stockItems: body.stockItems } : FAILED;
    } catch {
      return FAILED;
    }
  };
}

/**
 * 断りの応答のうち、この層が読む1項目だけ（`ErrorResponseDto` / ADR-032 決定3）。
 *
 * **`rule` が文字列であることまでしか見ない。** どの値が来るかは api 層の写像が決めており
 * （`RuleViolationStatus.ts`）、web が列挙を持つと、サーバが `rule` を増やした日に
 * 2か所がずれる。**値の意味を読むのは画面である。**
 */
function isRejection(body: unknown): body is ErrorResponseDto {
  return (
    typeof body === 'object' && body !== null && 'rule' in body && typeof body.rule === 'string'
  );
}

/**
 * 在庫品を登録しに行く口を組む（FR-01 / B-24）。
 *
 * **入力を詰め替えない**（規則2）。画面が作った `RegisterStockItemInput` をそのまま直列化して
 * 送る — 空欄を `null` に倒すのは画面の側（`StockItemFormValues.ts`）、前後の空白と期限の
 * 検めはサーバの側（`createStockItem`）であり、ここは運ぶだけである。
 *
 * **例外を外に出さない**（規則9）。トークンの取り出しが投げた・出口が投げた（オフライン・
 * 到達不能・CORS で塞がれた）・断りの本体が読めない・`rule` が無い、のすべてを `failed` に
 * 畳む。**断りの `rule` だけは畳まず `rejected` に載せる**（`RegisterStockItemOutcome`）。
 *
 * **自分では送り直さない**（規則10 / ADR-007）— 送り直すと、同名でも統合されない在庫品が
 * 2件残る。再送は利用者の操作に委ねる。
 */
export function registerStockItem(deps: StockItemRequestsDeps): RegisterStockItem {
  const { baseUrl, accessToken, httpFetch = environmentHttpFetch } = deps;

  return async (input) => {
    try {
      const token = await accessToken();

      // 規則7: `null` なら**要求を出さない**。空文字は `null` と同じに扱わない（`listStockItems` と同じ）。
      if (token === null) {
        return FAILED;
      }

      const response = await httpFetch(`${baseUrl}${STOCK_ITEMS_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': JSON_CONTENT_TYPE },
        body: JSON.stringify(input),
      });

      // **通ったときは本体を読まない。** 採番された識別子を受け取っても使い道が無く、
      // 読めない本体で成功を失敗に化けさせる理由も無い（`RegisterStockItemOutcome` の doc）。
      if (response.ok) {
        return REGISTERED;
      }

      const body = await response.json();

      return isRejection(body) ? { outcome: 'rejected', rule: body.rule } : FAILED;
    } catch {
      return FAILED;
    }
  };
}

/**
 * 在庫品を1件削除しに行く口を組む（FR-06 / B-23）。
 *
 * **消す相手は経路の識別子だけで表す。** 本体も持たず、クエリも付けず、世帯も運ばない
 * （規則6・15 / C-9）。**識別子は経路へ埋めるときだけ逃がす** — 形を検めるのではなく、
 * 一覧から渡った値が経路の区切りとして読まれないようにするためである（ADR-026）。
 *
 * **例外を外に出さない**（規則9）。トークンの取り出しが投げた・出口が投げた・断りの本体が
 * 読めない・`rule` が無い、のすべてを `failed` に畳む。**断りの `rule` だけは畳まず
 * `rejected` に載せる** — `delete.notFound` を「すでに消えている」と読むのは画面である
 * （ADR-027 / ADR-050 / `features/pantry/DeleteFailureNotice.ts`）。
 *
 * **自分では送り直さない**（規則10 / ADR-007）— 削除は冪等でないため（ADR-027）、送り直した
 * 2度目は**消せていても 404 を受け取る。** 再送は利用者の操作に委ねる。
 */
export function deleteStockItem(deps: StockItemRequestsDeps): DeleteStockItem {
  const { baseUrl, accessToken, httpFetch = environmentHttpFetch } = deps;

  return async (id) => {
    try {
      const token = await accessToken();

      // 規則7: `null` なら**要求を出さない**。空文字は `null` と同じに扱わない（`listStockItems` と同じ）。
      if (token === null) {
        return FAILED;
      }

      // 規則8: 本体が無いので `Content-Type` を付けない（付けると preflight の許可対象が増える）。
      const response = await httpFetch(`${baseUrl}${STOCK_ITEMS_PATH}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      // **通ったときは本体を読まない。** 応答は 204 であり、本体そのものが無い。
      if (response.ok) {
        return DELETED;
      }

      const body = await response.json();

      return isRejection(body) ? { outcome: 'rejected', rule: body.rule } : FAILED;
    } catch {
      return FAILED;
    }
  };
}

/**
 * 更新の結末（FR-05 / B-55 設計 5章 / 規則12・14）。
 *
 * **登録・削除と同じ3つの形を採る。** 断りの `rule` を畳まないのは、**`update.notFound` を
 * 「すでに消えている」と読まずに案内を出す判断が画面にある**ためである（ADR-050 結果5 /
 * `features/pantry/UpdateFailureNotice.ts`）。畳むと、その読み分けの材料がここで失われる。
 * どの `rule` が来るかは api 層の写像が正であり（`RuleViolationStatus.ts`）、**ここでは読まない**
 * （ADR-032 決定3 / `README.md`）。
 *
 * **成功に在庫品を載せない**（規則14）。応答の本体を受け取っても使い道が無く、一覧はサーバから
 * 取り直す（`App.tsx`）— web で行を書き換えると、並び（期限の近い順）を web が握り直すことになる。
 */
export type UpdateStockItemOutcome =
  | { readonly outcome: 'updated' }
  | { readonly outcome: 'rejected'; readonly rule: string }
  | { readonly outcome: 'failed' };

/**
 * 画面が受け取る口（B-55 設計 5章）。**この口も例外を投げない**（B-22 設計 規則9）。
 *
 * 受け取るのは在庫品の識別子と更新の入力だけで、**世帯は運ばない**（C-9 / NFR-09）。識別子の
 * 形は検めない — 形を決めるのは発行する側である（ADR-026）。
 */
export type UpdateStockItem = (
  id: string,
  input: UpdateStockItemInput,
) => Promise<UpdateStockItemOutcome>;

/** 更新が通ったこと（B-55 規則14）。応答は 200 だが本体は読まない。 */
const UPDATED = { outcome: 'updated' } as const;

/**
 * 在庫品1件を更新しに行く口を組む（FR-05 / B-55）。
 *
 * **書き換える相手は経路の識別子だけで表す。** クエリも付けず、世帯も運ばない（規則13 / C-9）。
 * **識別子は経路へ埋めるときだけ逃がす** — 形を検めるのではなく、一覧から渡った値が経路の
 * 区切りとして読まれないようにするためである（ADR-026）。
 *
 * **入力を詰め替えない**（規則12）。画面が作った `UpdateStockItemInput` をそのまま直列化して
 * 送る — 空欄を `null` に倒すのは画面の側（`StockItemFormValues.ts`）、前後の空白と期限の
 * 検めはサーバの側（`updateStockItem` / `expiryDateOf`）であり、ここは運ぶだけである。
 * **`null` を省略に読み替えない** — 更新は常に置き換えである。
 *
 * **例外を外に出さない**（B-22 設計 規則9）。トークンの取り出しが投げた・出口が投げた
 * （オフライン・到達不能・CORS で塞がれた）・断りの本体が読めない・`rule` が無い、のすべてを
 * `failed` に畳む。外へ出すと画面の側で誰も受け止めず、送っている表示のまま止まる
 * （規則7 が保存も「←」も止めているため、閉じられなくなる）。
 *
 * **自分では送り直さない**（規則12 / ADR-007）— 断られた回に送り直しても、利用者が入力を
 * 直さない限り同じ断りが返る（`update.notFound` なら相手は消えている）。再送は利用者の操作に委ねる。
 */
export function updateStockItem(deps: StockItemRequestsDeps): UpdateStockItem {
  const { baseUrl, accessToken, httpFetch = environmentHttpFetch } = deps;

  return async (id, input) => {
    try {
      const token = await accessToken();

      // 規則7: `null` なら**要求を出さない**。空文字は `null` と同じに扱わない（`listStockItems` と同じ）。
      if (token === null) {
        return FAILED;
      }

      const response = await httpFetch(`${baseUrl}${STOCK_ITEMS_PATH}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': JSON_CONTENT_TYPE },
        body: JSON.stringify(input),
      });

      // **通ったときは本体を読まない**（規則14）。読めない本体で成功を失敗に化けさせない。
      if (response.ok) {
        return UPDATED;
      }

      const body = await response.json();

      return isRejection(body) ? { outcome: 'rejected', rule: body.rule } : FAILED;
    } catch {
      return FAILED;
    }
  };
}
