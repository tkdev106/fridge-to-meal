/**
 * `setPointerCapture` を jsdom の上で補う継ぎ目（ADR-052 決定3 / B-40 設計 4章）。
 *
 * **jsdom 30 はこのメソッドを実装していない**（`PointerEvent` はある。2026-09-21 に実測）。
 * 行をなぞって消す経路（`PantryList.tsx` の `StockItemRow`）は、押下を受けた時点で
 * `event.currentTarget.setPointerCapture(event.pointerId)` を呼ぶため、補わないと
 * **押下の処理が例外で止まり、離上まで届かない。**
 *
 * **これは本体の振る舞いではない。** 道具（jsdom）の欠けを道具の側で埋めているだけであり、
 * `apps/web/src/**` は1行も変えない（設計 6章 規則1）。捕捉そのものの効き目
 * （行の外で指を離しても離上が届くこと）は jsdom では再現できないので、**何もしない実装**に
 * してある — テストは押下と離上を同じ行へ送る。
 */

/** `Element` のうち、ここで補う1つだけを見る形。 */
type PointerCapturing = {
  setPointerCapture?: (pointerId: number) => void;
};

/**
 * 実装が無ければ何もしないメソッドを足す。**既にあるなら触らない** —
 * jsdom が実装した日に、こちらの代役が本物を隠さないようにする。
 *
 * **`Element` は `globalThis` 越しに読む。** 裸で書くと、`tsc --build` が `dist-test/` へ
 * 出した `.js` の側で `no-undef` に当たる（先行 `StockItemForm.test.tsx` の `focused`）。
 */
export function installPointerCapture(): void {
  const prototype: PointerCapturing = globalThis.Element.prototype;
  if (typeof prototype.setPointerCapture === 'function') return;

  prototype.setPointerCapture = () => {};
}
