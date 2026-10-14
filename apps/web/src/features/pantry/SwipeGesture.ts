/**
 * 行をなぞる動きの読み方（FR-06 / FR-05 / `docs/screen-design.md` 5章）。指に合わせて右から `削除` が
 * 行の上へ滑り込む。離したときに半分を越えて見えていれば開いた位置に、越えていなければ元の位置に
 * 落ち着く。**なぞっただけでは消えない** — 消すのは現れた `削除` を押したときである。
 *
 * **判断はここに置き、実際の入力（ポインタの押下・移動・離上）は `.tsx` が拾う**（先行
 * `RegisterFailureNotice.ts` / `StockItemFormValues.ts` と同じ置き方）。**React も DOM の型も import しない。**
 *
 * **依存は足さない**（`docs/workflow.md` 3章）。要るのは座標の引き算だけであり、ジェスチャの
 * ライブラリを入れる理由が無い。
 */

/** なぞった点1つ。 */
export type SwipePoint = { readonly x: number; readonly y: number };

/**
 * 開いたときに現れる `削除` の幅（CSS ピクセル）。値の写しは
 * `PantryList.module.css` の `.revealedDelete` にある。
 */
export const REVEAL_WIDTH = 88;

/**
 * 動きを読み始めるまでの遊び（CSS ピクセル。B-55 規則15）。**指は静止しない** — これ未満の揺れは
 * タップと読み、これを越えて横に大きく動いたらなぞりと読む。
 */
const SLOP = 8;

/**
 * 横へなぞり始めたと読むか。**縦の動きのほうが大きければ読まない** — 一覧は縦に長く（FR-04）、
 * 縦は送りの操作である。行はそのまま送りに任せる（`touch-action: pan-y`）。
 */
export function startsHorizontalDrag(start: SwipePoint, point: SwipePoint): boolean {
  const horizontal = Math.abs(point.x - start.x);
  const vertical = Math.abs(point.y - start.y);

  return horizontal >= SLOP && horizontal > vertical;
}

/**
 * なぞっている間の `削除` の位置（左へ引いた量を負の数で返す）。**右へは引けない**（`削除` は
 * 右端にしか無い）。開いた位置を越えて引いた分は3分の1だけ動かし、引きすぎを手応えで伝える。
 */
export function swipeOffsetOf(revealed: boolean, start: SwipePoint, point: SwipePoint): number {
  const offset = (revealed ? -REVEAL_WIDTH : 0) + (point.x - start.x);

  if (offset >= 0) return 0;
  if (offset >= -REVEAL_WIDTH) return offset;

  return -REVEAL_WIDTH + (offset + REVEAL_WIDTH) / 3;
}

/** 離した位置で、開いた位置に落ち着くか。`削除` の半分を越えて見えていれば開く。 */
export function settlesRevealed(offset: number): boolean {
  return offset < -REVEAL_WIDTH / 2;
}

/**
 * 行のタップとして読むか（B-55 規則15 / FR-05）。縦横とも遊びの内側であることを要る — 縦を見ないと、
 * 送り始めて指を離した回に編集が開く。
 */
export function isTap(start: SwipePoint, end: SwipePoint): boolean {
  const horizontal = Math.abs(end.x - start.x);
  const vertical = Math.abs(end.y - start.y);

  // 境界は含まない（ちょうど遊びだけ動いたらタップと読まない）。
  return horizontal < SLOP && vertical < SLOP;
}
