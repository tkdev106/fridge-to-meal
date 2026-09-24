/**
 * `GET /suggestions/latest`（B-58 / B-49a）を叩く工場と、その結末。
 *
 * **ここは画面ではない。** 経路の継ぎ目であり、`@supabase/*` を1つも触らない —
 * トークンは `accessToken()` の1引数で受け取る（ADR-046 決定3 / 先行 `StockItemRequests`）。
 * **世帯は1つも運ばない**（C-9 / NFR-09）— 世帯はアクセストークンから定まる。
 *
 * **`POST /suggestions/new-meals`（FR-36 の明示操作）はここに無い。** 置くのは B-49b であり、
 * 押す操作と待ち時間の見せ方（S-5 / S-6）と1組でないと画面に届かない。
 */
import type { ShowLatestSuggestionOutput, SuggestionOutput } from '@fridge-to-meal/contract';
import type { HttpFetch } from './HttpFetch.js';

/**
 * 保存済みの提案の結末。**サーバの2つの結末をそのまま持ち、失敗を1つ足しただけ**である。
 *
 * **在庫が足りない回（S-4）も上限に達した回（S-7）もここには無い。** どちらも生成を試みた
 * ときにしか起きず、この経路は生成を一度も呼ばない（ADR-065 決定3）。**代わりに
 * 「まだ1件も保存されていない」（S-8）が起こる。**
 *
 * **`failed` は手がかりの無い1つである**（先行 `StockItemsOutcome`）。通信の失敗・401・500・
 * 壊れた応答を分けない — どれも利用者の入力では直せず、画面に見分ける材料が無い。
 */
export type LatestSuggestionOutcome = ShowLatestSuggestionOutput | { readonly outcome: 'failed' };

/** 画面が受け取る口。**この口は例外を投げない**（先行 `ListStockItems`）。 */
export type ShowLatestSuggestion = () => Promise<LatestSuggestionOutcome>;

export type SuggestionRequestsDeps = {
  readonly baseUrl: string;
  /** `Session.accessToken` を渡す。継ぎ目の型そのものは受け取らない */
  readonly accessToken: () => Promise<string | null>;
  readonly httpFetch?: HttpFetch; // 既定は実行環境の fetch
};

/**
 * 叩く先は基点にこれを足した1つだけ。**接頭辞を web の側で足さない**（ADR-048 決定4）。
 */
const LATEST_SUGGESTION_PATH = '/suggestions/latest';

/** 畳んだ失敗（先行 `StockItemRequests` の `FAILED`）。 */
const FAILED = { outcome: 'failed' } as const;

/** 既定の出口。**実行環境の `fetch` をそのまま使う**（先行 `StockItemRequests`）。 */
const environmentHttpFetch: HttpFetch = (url, init) => fetch(url, init);

/**
 * 応答の本体のうち、この層が読むところだけ。
 *
 * **要素の中身は検めない** — 相手は自分のサーバであり、contract の型で返す側が正である
 * （先行 `isListed`）。`entries` が配列であることまでしか見ず、1件ずつの型は
 * `SuggestionEntryOutput` として受ける。**0件の提案に倒さない** — 献立があるのに
 * 無いように見せることになる。
 */
function isSuggested(body: unknown): body is {
  readonly outcome: 'suggested';
  readonly suggestion: SuggestionOutput;
  readonly pantryChanged: boolean;
} {
  if (typeof body !== 'object' || body === null) return false;
  if (!('outcome' in body) || body.outcome !== 'suggested') return false;
  if (!('suggestion' in body)) return false;

  const { suggestion } = body;

  return (
    typeof suggestion === 'object' &&
    suggestion !== null &&
    'entries' in suggestion &&
    Array.isArray(suggestion.entries)
  );
}

/** まだ1件も保存されていない結末かどうか（S-8）。 */
function isNone(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'outcome' in body && body.outcome === 'none';
}

/**
 * 保存済みの提案を取りに行く口を組む（FR-16 / FR-21 / B-49a / B-58）。
 *
 * **`GET` である**（ADR-065 決定2）— この経路は生成を一度も呼ばず、費用も副作用も無い。
 * **画面を出すだけで1日10回の枠（NFR-C2）を使わないのはこのためである。** 生成は
 * 「新しい献立を求める」（FR-36 / B-49b）だけで起こる。
 * **本体もクエリも送らない**（B-48b 規則3・4）— 世帯はアクセストークンから定まり、
 * 利用者が動かせる入力がこの経路に無い。本体が無いので `Content-Type` も付けない
 * （付けると preflight の許可対象が増える。ADR-048）。
 *
 * **DTO を詰め替えない**（先行 `listStockItems` 規則2）。並べ替えもしない — 提案の1件の
 * 並びはサーバが決めたものであり、決定的でなければならない（C-12）。
 *
 * **例外を外に出さない**（同 規則9）。トークンの取り出しが投げた・出口が投げた・`ok` が偽・
 * 本体が読めない・知らない `outcome`、のすべてを `failed` に畳む。外へ出すと門の効果で
 * 誰も受け止めず、読み込み中のまま画面が止まる（FR-41）。
 *
 * **自分では取りに行き直さない**（同 規則10）— 呼ばれた1回で1往復だけする。
 */
export function showLatestSuggestion(deps: SuggestionRequestsDeps): ShowLatestSuggestion {
  const { baseUrl, accessToken, httpFetch = environmentHttpFetch } = deps;

  return async () => {
    try {
      const token = await accessToken();

      // `null` なら**要求を出さない**（先行 `listStockItems` 規則7）。出しても 401 が返るだけで、
      // 往復を1つ無駄にする。**空文字は `null` と同じに扱わない。**
      if (token === null) {
        return FAILED;
      }

      const response = await httpFetch(`${baseUrl}${LATEST_SUGGESTION_PATH}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        return FAILED;
      }

      const body = await response.json();

      if (isSuggested(body)) {
        return {
          outcome: 'suggested',
          suggestion: body.suggestion,
          pantryChanged: body.pantryChanged === true,
        };
      }

      return isNone(body) ? { outcome: 'none' } : FAILED;
    } catch {
      return FAILED;
    }
  };
}
