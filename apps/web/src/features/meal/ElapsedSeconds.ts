/**
 * 生成中の経過秒数（B-62 設計 6章 規則4 / NFR-04 / D-6）。
 *
 * 時刻は引数で受け取り、ここでは時計を読まない（`docs/testing.md` 5章）。
 */

/**
 * 開始から現在までの経過を、切り捨てた秒で返す。単位はどちらもミリ秒（epoch）。
 *
 * **上限を設けない** — 原本 `RequestBlock` で 48 を超えたら戻るのは見本用の動きである。
 * **開始が現在より未来なら 0 を返す**（時計の巻き戻り。例外にしない。設計 7章）。
 */
export function elapsedSecondsOf(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
