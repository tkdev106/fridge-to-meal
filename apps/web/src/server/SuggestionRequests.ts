/**
 * `POST /suggestions`（B-48b / B-49a）を叩く工場と、その結末。
 *
 * **ここは画面ではない。** 経路の継ぎ目であり、`@supabase/*` を1つも触らない —
 * トークンは `accessToken()` の1引数で受け取る（ADR-046 決定3 / 先行 `StockItemRequests`）。
 * **世帯は1つも運ばない**（C-9 / NFR-09）— 世帯はアクセストークンから定まる。
 *
 * **`POST /suggestions/new-meals`（FR-36 の明示操作）はここに無い。** 置くのは B-49b であり、
 * 押す操作と待ち時間の見せ方（S-5 / S-6）と1組でないと画面に届かない。
 */
import type { SuggestMealsOutput, SuggestionOutput } from '@fridge-to-meal/contract';
import type { HttpFetch } from './HttpFetch.js';

/**
 * 提案の結末。**サーバの3つの結末をそのまま持ち、失敗を1つ足しただけ**である。
 *
 * **在庫が足りない回（S-4）と上限に達した回（S-7）を `failed` に畳まない。** どちらも
 * 失敗でも規則違反でもなく 200 で返る結末であり（ADR-041 / ADR-062 決定2）、畳むと
 * 画面が「在庫を足せば出る」「今日はもう出ない」を言い分けられなくなる（`docs/screen-design.md` D-7）。
 *
 * **`failed` は手がかりの無い1つである**（先行 `StockItemsOutcome`）。通信の失敗・401・500・
 * 壊れた応答を分けない — どれも利用者の入力では直せず、画面に見分ける材料が無い。
 */
export type SuggestMealsOutcome = SuggestMealsOutput | { readonly outcome: 'failed' };

/** 画面が受け取る口。**この口は例外を投げない**（先行 `ListStockItems`）。 */
export type SuggestMeals = () => Promise<SuggestMealsOutcome>;

export type SuggestionRequestsDeps = {
  readonly baseUrl: string;
  /** `Session.accessToken` を渡す。継ぎ目の型そのものは受け取らない */
  readonly accessToken: () => Promise<string | null>;
  readonly httpFetch?: HttpFetch; // 既定は実行環境の fetch
};

/**
 * 叩く先は基点にこれを足した1つだけ。**接頭辞を web の側で足さない**（ADR-048 決定4）。
 */
const SUGGESTIONS_PATH = '/suggestions';

/** 畳んだ失敗（先行 `StockItemRequests` の `FAILED`）。 */
const FAILED = { outcome: 'failed' } as const;

/** 既定の出口。**実行環境の `fetch` をそのまま使う**（先行 `StockItemRequests`）。 */
const environmentHttpFetch: HttpFetch = (url, init) => fetch(url, init);

/**
 * 献立を伴わない2つの結末（S-4 / S-7）。**値そのものを持たせる** — api 層が返す
 * `outcome` の綴りは contract の union が正であり、ここで別の名に写さない。
 */
const MEALLESS_OUTCOMES: readonly string[] = ['insufficientStockItems', 'generationLimitReached'];

/**
 * 応答の本体のうち、この層が読むところだけ。
 *
 * **要素の中身は検めない** — 相手は自分のサーバであり、contract の型で返す側が正である
 * （先行 `isListed`）。`entries` が配列であることまでしか見ず、1件ずつの型は
 * `SuggestionEntryOutput` として受ける。**0件の提案に倒さない** — 献立があるのに
 * 無いように見せることになる。
 */
function isSuggested(
  body: unknown,
): body is { readonly outcome: 'suggested'; readonly suggestion: SuggestionOutput } {
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

/** 献立を伴わない結末かどうか（S-4 / S-7）。 */
function mealessOutcomeOf(body: unknown): SuggestMealsOutput | null {
  if (typeof body !== 'object' || body === null || !('outcome' in body)) return null;

  const { outcome } = body;
  if (typeof outcome !== 'string' || !MEALLESS_OUTCOMES.includes(outcome)) return null;

  return { outcome } as SuggestMealsOutput;
}

/**
 * 提案を取りに行く口を組む（FR-16 / FR-21 / B-49a）。
 *
 * **`POST` に置く**（ADR-062 決定1）— 提案は保存と生成の費用を伴い、安全な method に載せない。
 * **本体もクエリも送らない**（B-48b 規則3・4）— 世帯はアクセストークンから、基準日時は
 * サーバの時刻から定まり、利用者が動かせる入力がこの経路に無い。本体が無いので
 * `Content-Type` も付けない（付けると preflight の許可対象が増える。ADR-048）。
 *
 * **DTO を詰め替えない**（先行 `listStockItems` 規則2）。並べ替えもしない — 提案の1件の
 * 並びはサーバが決めたものであり、決定的でなければならない（C-12）。
 *
 * **例外を外に出さない**（同 規則9）。トークンの取り出しが投げた・出口が投げた・`ok` が偽・
 * 本体が読めない・知らない `outcome`、のすべてを `failed` に畳む。外へ出すと門の効果で
 * 誰も受け止めず、読み込み中のまま画面が止まる（FR-41）。
 *
 * **自分では取りに行き直さない**（同 規則10）— 呼ばれた1回で1往復だけする。**再試行は
 * とりわけ避けたい経路である** — 既定の提案でも作れる献立が0件なら生成を呼ぶため（C-4）、
 * 自動の再試行が1日10回の枠（NFR-C2）を黙って削る。
 */
export function suggestMeals(deps: SuggestionRequestsDeps): SuggestMeals {
  const { baseUrl, accessToken, httpFetch = environmentHttpFetch } = deps;

  return async () => {
    try {
      const token = await accessToken();

      // `null` なら**要求を出さない**（先行 `listStockItems` 規則7）。出しても 401 が返るだけで、
      // 往復を1つ無駄にする。**空文字は `null` と同じに扱わない。**
      if (token === null) {
        return FAILED;
      }

      const response = await httpFetch(`${baseUrl}${SUGGESTIONS_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        return FAILED;
      }

      const body = await response.json();

      if (isSuggested(body)) {
        return { outcome: 'suggested', suggestion: body.suggestion };
      }

      return mealessOutcomeOf(body) ?? FAILED;
    } catch {
      return FAILED;
    }
  };
}
