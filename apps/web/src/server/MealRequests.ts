/**
 * `GET /meals/:id`（B-52 / ADR-067）と `POST /meals/:id/cooking-records`（B-51）を叩く
 * 2つの工場と、その結末（B-53 設計 5章）。
 *
 * **ここは画面ではない。** 経路の継ぎ目であり、`@supabase/*` も `session/` の型も触らない —
 * トークンは `accessToken()` の1引数で受け取る（ADR-046 決定3 / 先行 `SuggestionRequests`）。
 * **世帯は1つも運ばない**（C-9 / NFR-09）— 世帯はアクセストークンから定まる。
 */
import type { MealOutput } from '@fridge-to-meal/contract';
import type { HttpFetch } from './HttpFetch.js';

/**
 * 献立1件を取りに行った結末（設計 5章 / 7章）。
 *
 * **`rejected` は `rule` を持つ本体が読めたときだけ**で、それ以外はすべて `failed` に畳む
 * （規則14）。`showMeal.mealNotFound` を失敗と同じ案内に畳むかどうかは画面の判断である
 * （ADR-032 決定3 / 先行 `DeleteFailureNotice`）。
 */
export type MealOutcome =
  | { readonly outcome: 'shown'; readonly meal: MealOutput }
  | { readonly outcome: 'rejected'; readonly rule: string }
  | { readonly outcome: 'failed' };

/** 画面が受け取る口。**この口は例外を投げない**（規則14）。 */
export type ShowMeal = (mealId: string) => Promise<MealOutcome>;

/** 調理記録を1件足した結末（FR-22 / 設計 7章）。 */
export type AddCookingRecordOutcome =
  | { readonly outcome: 'recorded' }
  | { readonly outcome: 'rejected'; readonly rule: string }
  | { readonly outcome: 'failed' };

/** 画面が受け取る口。**この口も例外を投げない**（規則14）。 */
export type AddCookingRecord = (mealId: string) => Promise<AddCookingRecordOutcome>;

export type MealRequestsDeps = {
  readonly baseUrl: string;
  /** `Session.accessToken` を渡す。継ぎ目の型そのものは受け取らない */
  readonly accessToken: () => Promise<string | null>;
  readonly httpFetch?: HttpFetch; // 既定は実行環境の fetch
};

/** 叩く先の根。**接頭辞を web の側で足さない**（ADR-048 決定4）。 */
const MEALS_PATH = '/meals';

/** 調理記録の経路の末尾（B-51）。 */
const COOKING_RECORDS_PATH = '/cooking-records';

/** 畳んだ失敗（先行 `SuggestionRequests` の `FAILED`）。 */
const FAILED = { outcome: 'failed' } as const;

/** 既定の出口。**実行環境の `fetch` をそのまま使う**（先行 `SuggestionRequests`）。 */
const environmentHttpFetch: HttpFetch = (url, init) => fetch(url, init);

/**
 * 識別子を経路に載せる形にする（規則16）。**符号化だけを施し、加工はしない** —
 * 前後の空白を落とすと、サーバが断るはずの入力が別の識別子に化ける（ADR-026）。
 */
function mealPathOf(mealId: string): string {
  return `${MEALS_PATH}/${encodeURIComponent(mealId)}`;
}

/**
 * 断りの本体かどうか（先行 `StockItemRequests` の `isRejection`）。
 *
 * **`rule` が文字列であることまでしか見ない。** どの値が来るかは api 層の写像が決めており
 * （`RuleViolationStatus.ts`）、web が列挙を持つと、サーバが `rule` を増やした日に
 * 黙って失敗へ倒れる。
 */
function isRejection(body: unknown): body is { readonly rule: string } {
  return (
    typeof body === 'object' && body !== null && 'rule' in body && typeof body.rule === 'string'
  );
}

/**
 * 応答の本体のうち、この層が読むところだけ。
 *
 * **要素の中身は検めない** — 相手は自分のサーバであり、contract の型で返す側が正である
 * （先行 `isSuggested`）。画面が読む4つ（`ingredients` / `steps` / `coverage.covered` /
 * `coverage.missing`）が配列であることまでを見て、それ以上は検めない。
 */
function isShownMeal(body: unknown): body is MealOutput {
  if (typeof body !== 'object' || body === null) return false;
  if (!('ingredients' in body) || !Array.isArray(body.ingredients)) return false;
  if (!('steps' in body) || !Array.isArray(body.steps)) return false;
  if (!('coverage' in body)) return false;

  const { coverage } = body;

  return (
    typeof coverage === 'object' &&
    coverage !== null &&
    'covered' in coverage &&
    Array.isArray(coverage.covered) &&
    'missing' in coverage &&
    Array.isArray(coverage.missing)
  );
}

/**
 * 献立1件を取りに行く口を組む（FR-30 / FR-32 / 規則1・14〜16）。
 *
 * **`GET` である** — 読み取りだけで費用も副作用も無く、充足は開いた時点の在庫で
 * 算出される（ADR-009 / ADR-067）。**本体もクエリも送らない**（B-48b 規則3・4）ので
 * `Content-Type` も付けない（ADR-048）。
 *
 * **DTO を詰め替えない**（規則15）。並べ替えも件数の計算もしない — 材料の並びと印は
 * 画面側の純粋関数（`features/meal/MealDetailIngredients.ts`）の持ち分である。
 *
 * **例外を外に出さない**（規則14）。外へ出すと門の効果で誰も受け止めず、読み込み中のまま
 * 画面が止まる（FR-41）。**自分では取りに行き直さない** — 呼ばれた1回で1往復だけする。
 */
export function showMeal(deps: MealRequestsDeps): ShowMeal {
  const { baseUrl, accessToken, httpFetch = environmentHttpFetch } = deps;

  return async (mealId) => {
    try {
      const token = await accessToken();

      // `null` なら**要求を出さない**（先行 `listStockItems` 規則7）。出しても 401 が返るだけで、
      // 往復を1つ無駄にする。**空文字は `null` と同じに扱わない。**
      if (token === null) {
        return FAILED;
      }

      const response = await httpFetch(`${baseUrl}${mealPathOf(mealId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      const body = await response.json();

      if (!response.ok) {
        return isRejection(body) ? { outcome: 'rejected', rule: body.rule } : FAILED;
      }

      return isShownMeal(body) ? { outcome: 'shown', meal: body } : FAILED;
    } catch {
      return FAILED;
    }
  };
}

/**
 * 調理記録を1件足す口を組む（FR-22 / C-8 / 規則13・14・16）。
 *
 * **通った回の本体を読まない** — 相手は 204 で本体を返さない（B-51。先行 `deleteStockItem`）。
 * **記録の日時も本体も送らない**（B-48b 規則4）— 日時はサーバが要求ごとに時計を読む。
 * 本体が無いので `Content-Type` も付けない（ADR-048）。
 *
 * **「作った」を記録しても在庫は減らない**（C-8）— この継ぎ目は在庫の口を1つも触らない。
 *
 * **例外を外に出さない**（規則14）。`rule` の意味は読まず、案内を選ぶのは画面の
 * `cookingRecordFailureNoticeOf` である（ADR-032 決定3 / 規則13）。
 */
export function addCookingRecord(deps: MealRequestsDeps): AddCookingRecord {
  const { baseUrl, accessToken, httpFetch = environmentHttpFetch } = deps;

  return async (mealId) => {
    try {
      const token = await accessToken();

      if (token === null) {
        return FAILED;
      }

      const response = await httpFetch(`${baseUrl}${mealPathOf(mealId)}${COOKING_RECORDS_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        return { outcome: 'recorded' };
      }

      const body = await response.json();

      return isRejection(body) ? { outcome: 'rejected', rule: body.rule } : FAILED;
    } catch {
      return FAILED;
    }
  };
}
