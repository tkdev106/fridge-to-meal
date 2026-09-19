/**
 * `GET /stock-items` を叩く工場と読み込みの結末（B-22 設計 5章 / 規則2・3・6〜10 / 7章）。
 *
 * **ここは画面ではない。** 経路の継ぎ目であり、`@supabase/*` を1つも触らない —
 * トークンは `accessToken()` の1引数で受け取る（規則1 / ADR-046 決定3）。
 * **世帯は1つも運ばない**（C-9 / NFR-09）。
 */
import type { StockItemDto } from '@fridge-to-meal/contract';
import type { HttpFetch } from './HttpFetch.js';

/**
 * 読み込みの結末（設計 5章 / 規則9）。
 *
 * **失敗の種別を分けない** — `rule` も状態コードも読まない（ADR-032 決定3 は B-24）。
 */
export type StockItemsOutcome =
  | { readonly outcome: 'loaded'; readonly stockItems: readonly StockItemDto[] }
  | { readonly outcome: 'failed' };

/** 画面が受け取る口。**この口は例外を投げない**（規則9）。 */
export type ListStockItems = () => Promise<StockItemsOutcome>;

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

/** 畳んだ失敗はどれも同じ1つの結末である（規則9 / 7章）。 */
const FAILED: StockItemsOutcome = { outcome: 'failed' };

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
