/**
 * 行をなぞった動きを、削除のスワイプとして読むかを決める（FR-06 / B-23。
 * `docs/screen-design.md` 5章「削除は行のスワイプ」）。
 *
 * **判断はここに置き、実際の入力（ポインタの押下と離上）は `.tsx` が拾う**（先行
 * `RegisterFailureNotice.ts` / `StockItemFormValues.ts` と同じ置き方）— `.tsx` は vitest が
 * 拾わない（`include` は `*.test.ts`、`environment: 'node'`）ため、判断を置くと誰も
 * 確かめられなくなる。**React も DOM の型も import しない。**
 *
 * **依存は足さない**（`docs/workflow.md` 3章）。要るのは2点の座標の引き算だけであり、
 * ジェスチャのライブラリを入れる理由が無い。
 */

/** なぞった点1つ。押下と離上の2点だけを見る（途中の軌跡は持たない）。 */
export type SwipePoint = { readonly x: number; readonly y: number };

/**
 * 削除と読むのに要する横の長さ（CSS ピクセル）。
 *
 * **確認を出さない以上**（`docs/screen-design.md` 5章）、触れただけ・わずかに滑っただけで
 * 消えないことをこちら側で守る。**行の高さの倍ほどの長さ**であり、指で意図して引かないと届かない。
 */
const DELETE_SWIPE_DISTANCE = 64;

/**
 * 削除のスワイプとして読むか。
 *
 * **向きは問わない。** `docs/screen-design.md` 5章 は「行のスワイプ」としか定めておらず、
 * 片方の向きだけを受け取ると、**逆になぞった回は何も起きない** — 確認も取り消しも無い画面
 * では、起きなかった理由を知る手がかりが残らない（同章 / ADR-050 の構え）。
 *
 * **縦の動きのほうが大きければ読まない。** 在庫の一覧は縦に長く（FR-04）、縦になぞるのは
 * 送りの操作である。斜めに流れた送りで行が消えると、取り消しの無い操作が事故で起きる。
 */
export function isDeleteSwipe(start: SwipePoint, end: SwipePoint): boolean {
  const horizontal = Math.abs(end.x - start.x);
  const vertical = Math.abs(end.y - start.y);

  if (horizontal < DELETE_SWIPE_DISTANCE) return false;

  return horizontal > vertical;
}

/**
 * タップと読むのに許す動きの長さ（CSS ピクセル。B-55 規則15）。
 *
 * **指は静止しない。** 押して離すまでのわずかな揺れで編集を開けなくなると、開く手立てが
 * 他に無い（`docs/screen-design.md` 2章 `pantry --> edit` の導線はこれ1つである）。
 * **`DELETE_SWIPE_DISTANCE`（64px）よりずっと小さく取る** — 2つの閾値の間に隙間を空け、
 * どちらにも当たらない中途半端な動きでは何も起こさない（B-55 規則15）。
 */
const TAP_DISTANCE = 8;

/**
 * 行のタップとして読むか（B-55 規則15 / FR-05）。
 *
 * **縦横どちらの移動も閾値未満であることを要る。** 向きは問わない（`isDeleteSwipe` と同じ）—
 * タップは「動かさなかったこと」であって、どちらへ動かさなかったかではない。
 *
 * **縦を横と同じ閾値で見る。** 一覧は縦に長く（FR-04）、送りの操作は縦に流れる。縦を見ないと、
 * 送り始めて指を離した回に編集が開く。
 *
 * **削除として読んだ動きはここを通らない** — 64px 動いた点は 8px の閾値を越えており、
 * 取り消しの無い削除と編集の画面が同時に起きることが**距離の取り方だけで**防がれている
 * （旗でも順序でも保っていないので、片方を消しても崩れない）。
 */
export function isTap(start: SwipePoint, end: SwipePoint): boolean {
  const horizontal = Math.abs(end.x - start.x);
  const vertical = Math.abs(end.y - start.y);

  // 境界は含まない（ちょうど閾値だけ動いたらタップと読まない）。
  return horizontal < TAP_DISTANCE && vertical < TAP_DISTANCE;
}
