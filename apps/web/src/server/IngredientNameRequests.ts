/**
 * `GET /ingredient-names`（B-50b / B-50c）を叩く工場と、その結末。
 *
 * **ここは画面ではない。** 経路の継ぎ目であり、`@supabase/*` を1つも触らない —
 * トークンは `accessToken()` の1引数で受け取る（ADR-046 決定3 / 先行 `StockItemRequests`）。
 * **世帯は1つも運ばない**（C-9 / NFR-09）— 世帯はアクセストークンから定まる。
 *
 * **ここにあるのはカタログ上の食材ではない**（`contract/ingredient.ts`）。MVP に食材マスタは
 * 無く（要件 11章 論点4）、運ぶのは在庫品の名称と主材料の名称をまたいで集めた**名称の列**だけ
 * である（ADR-063）。
 */
import type { ListIngredientNamesOutput } from '@fridge-to-meal/contract';
import type { HttpFetch } from './HttpFetch.js';

/**
 * 食材名の結末（B-50c 設計 規則2）。**失敗の種別を分けない**（先行 `StockItemsOutcome`）—
 * `rule` も状態コードも読まない。この経路に利用者が直せる入力は1つも無く、画面に見分ける
 * 材料も無い。
 *
 * **「取れなかった」と「1件も無い」を畳まないのは、畳む場所が画面だからである**（設計 規則3）。
 * どちらも補完が出ないという同じ見え方になるが、その読みは
 * `features/pantry/IngredientNameOptions.ts` が1か所で持つ（先行 `deleteFailureNoticeOf`）。
 */
export type IngredientNamesOutcome =
  | { readonly outcome: 'loaded'; readonly ingredientNames: readonly string[] }
  | { readonly outcome: 'failed' };

/** 画面が受け取る口。**この口は例外を投げない**（先行 `ListStockItems`）。 */
export type ListIngredientNames = () => Promise<IngredientNamesOutcome>;

export type IngredientNameRequestsDeps = {
  readonly baseUrl: string;
  /** `Session.accessToken` を渡す。継ぎ目の型そのものは受け取らない */
  readonly accessToken: () => Promise<string | null>;
  readonly httpFetch?: HttpFetch; // 既定は実行環境の fetch
};

/** 叩く先は基点にこれを足した1つだけ。**接頭辞を web の側で足さない**（B-22 設計 規則15）。 */
const INGREDIENT_NAMES_PATH = '/ingredient-names';

/** 畳んだ失敗（先行 `StockItemRequests` の `FAILED`）。 */
const FAILED = { outcome: 'failed' } as const;

/** 既定の出口。**実行環境の `fetch` をそのまま使う**（先行 `StockItemRequests`）。 */
const environmentHttpFetch: HttpFetch = (url, init) => fetch(url, init);

/**
 * 応答の本体のうち、この層が読む1項目だけ（先行 `isListed`）。
 *
 * **形は contract の `ListIngredientNamesOutput` をそのまま名乗る**（`server/README.md`）—
 * web が第2の DTO を持つと、サーバが項目を改名した日に web 側だけ型が通る。
 *
 * **要素の中身は検めない** — 相手は自分のサーバであり、contract の型で返す側が正である。
 * **`ingredientNames` が無い本体を0件に倒さない** — 名称があるのに無いように見せることになる。
 */
function isListed(body: unknown): body is ListIngredientNamesOutput {
  return (
    typeof body === 'object' &&
    body !== null &&
    'ingredientNames' in body &&
    Array.isArray(body.ingredientNames)
  );
}

/**
 * 食材名を取りに行く口を組む（FR-02 / B-50c）。
 *
 * **`GET` である**（B-50b / ADR-063）— 読み取りだけで費用も副作用も無い。**本体もクエリも
 * 送らない** — 世帯はアクセストークンから定まり、利用者が動かせる入力がこの経路に無い。
 * 本体が無いので `Content-Type` も付けない（付けると preflight の許可対象が増える。ADR-048）。
 *
 * **詰め替えない・並べ替えない**（先行 `listStockItems` 規則2・3）— 並び（コード単位の昇順）と
 * 重複の畳み方（名称の完全一致。C-6）はサーバが決めたものである。
 *
 * **例外を外に出さない**（同 規則9）。トークンの取り出しが投げた・出口が投げた・`ok` が偽・
 * 本体が読めない・`ingredientNames` が配列でない、のすべてを `failed` に畳む。**取れなくても
 * 登録は止まらない**（FR-02 / FR-03）— 補完は入力を助けるだけである。
 *
 * **自分では取りに行き直さない**（同 規則10）— 呼ばれた1回で1往復だけする。
 */
export function listIngredientNames(deps: IngredientNameRequestsDeps): ListIngredientNames {
  const { baseUrl, accessToken, httpFetch = environmentHttpFetch } = deps;

  return async () => {
    try {
      const token = await accessToken();

      // `null` なら**要求を出さない**（先行 `listStockItems` 規則7）。出しても 401 が返るだけで、
      // 往復を1つ無駄にする。**空文字は `null` と同じに扱わない。**
      if (token === null) {
        return FAILED;
      }

      const response = await httpFetch(`${baseUrl}${INGREDIENT_NAMES_PATH}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        return FAILED;
      }

      const body = await response.json();

      return isListed(body) ? { outcome: 'loaded', ingredientNames: body.ingredientNames } : FAILED;
    } catch {
      return FAILED;
    }
  };
}
