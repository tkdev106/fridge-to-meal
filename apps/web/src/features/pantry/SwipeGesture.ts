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
