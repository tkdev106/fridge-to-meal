/**
 * `DELETE /household-data`（B-56a / B-56d / ADR-073）を叩く口の工場と、その結末（B-56f 設計 5章）。
 *
 * **ここは画面ではない。** 経路の継ぎ目であり、`@supabase/*` も `session/` の型も触らない
 * （ADR-046 決定3）。**世帯は1つも運ばない**（C-9 / NFR-09）。
 */
import type { HttpFetch } from './HttpFetch.js';

/** 世帯のデータを消した結末（設計 5章 / 規則3）。`rule` を運ばない。 */
export type DeleteHouseholdDataOutcome =
  { readonly outcome: 'deleted' } | { readonly outcome: 'failed' };

/** 画面が受け取る口。例外を投げない。 */
export type DeleteHouseholdData = () => Promise<DeleteHouseholdDataOutcome>;

export type HouseholdDataRequestsDeps = {
  readonly baseUrl: string;
  /** `Session.accessToken` を渡す。継ぎ目の型そのものは受け取らない */
  readonly accessToken: () => Promise<string | null>;
  readonly httpFetch?: HttpFetch; // 既定は実行環境の fetch
};

/** 叩く先。**接頭辞を web の側で足さない**（ADR-048 決定4）。 */
const HOUSEHOLD_DATA_PATH = '/household-data';

/** 畳んだ失敗（先行 `MealRequests` の `FAILED`）。 */
const FAILED = { outcome: 'failed' } as const;

/** 既定の出口。**実行環境の `fetch` をそのまま使う**（先行 `MealRequests`）。 */
const environmentHttpFetch: HttpFetch = (url, init) => fetch(url, init);

/**
 * 世帯のデータ（と利用者。ADR-073）を消す口を組む（FR-27 / 規則1〜3・9）。
 *
 * **本体を送らない**（B-56a 規則9）ので `Content-Type` も付けない（ADR-048）。**通った回の本体を
 * 読まない** — 相手は 204 で本体を返さない（先行 `deleteStockItem` / `addCookingRecord`）。
 * **断りも `rule` を読まず失敗に畳む** — 利用者が直せる入力が無く、読み分ける判断も画面に無い
 * （先行 `listMeals`）。
 *
 * **例外を外に出さない。** 自分では送り直さない — 呼ばれた1回で1往復だけする。
 */
export function deleteHouseholdData(deps: HouseholdDataRequestsDeps): DeleteHouseholdData {
  const { baseUrl, accessToken, httpFetch = environmentHttpFetch } = deps;

  return async () => {
    try {
      const token = await accessToken();

      // `null` なら**要求を出さない**（先行 `listStockItems` 規則7）。**空文字は `null` と同じに
      // 扱わない。**
      if (token === null) {
        return FAILED;
      }

      const response = await httpFetch(`${baseUrl}${HOUSEHOLD_DATA_PATH}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      return response.ok ? { outcome: 'deleted' } : FAILED;
    } catch {
      return FAILED;
    }
  };
}
