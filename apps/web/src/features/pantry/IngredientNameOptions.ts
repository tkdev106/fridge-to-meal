/**
 * 食材名の結末から、補完に出す名称を選ぶ（FR-02 / FR-03 / B-50c 設計 規則3）。
 *
 * **判断はここに置く**（先行 `DeleteFailureNotice.ts` / `RegisterFailureNotice.ts` と同じ置き方）。
 * 継ぎ目（`server/IngredientNameRequests.ts`）は「取れた」と「取れなかった」を分けて運ぶだけで、
 * **どちらも補完が出ないという同じ見え方に倒す**のは画面の判断である。
 *
 * **日本語を1つも持たない。** 補完に出るのはサーバから来た名称だけで、案内も注記も足さない —
 * 取れなかったことを利用者に知らせない（FR-02 / FR-03。補完は入力を助けるだけで、登録を止めない）。
 */

import type { IngredientNamesOutcome } from '../../server/IngredientNameRequests.js';

/**
 * 画面が受け取る3値（先行 `PantryListState` / `MealsTabState`）。**まだ取れていない間も
 * 登録の画面は開ける**ので、`'loading'` をここに足す。
 */
export type IngredientNamesState = { readonly outcome: 'loading' } | IngredientNamesOutcome;

/** 補完が1つも出ないこと。**3つの結末のうち2つがここへ落ちる。** */
const NO_OPTIONS: readonly string[] = [];

/**
 * 補完に出す名称を選ぶ。
 *
 * **並べ替えない・畳み直さない**（B-50c 設計 規則5）— 並び（コード単位の昇順）も重複の
 * 畳み方（名称の完全一致。C-6）もサーバが決めたものであり、web が握り直すと2か所がずれる。
 *
 * **絞り込みもしない。** 打ちかけの文字に合う名称を選ぶのは `<datalist>` を持つブラウザの
 * 仕事であり（設計 2章）、ここで先回りすると**自由入力を止める**実装へ近づく（FR-03）。
 */
export function ingredientNameOptionsOf(state: IngredientNamesState): readonly string[] {
  return state.outcome === 'loaded' ? state.ingredientNames : NO_OPTIONS;
}
