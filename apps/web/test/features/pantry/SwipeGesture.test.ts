import { describe, expect, it } from 'vitest';
import {
  isTap,
  settlesRevealed,
  startsHorizontalDrag,
  swipeOffsetOf,
} from '../../../src/features/pantry/SwipeGesture.js';

/** 押した点の標本。どこから始めても結論は動かないので、原点から離した1点に固定する。 */
const start = { x: 200, y: 200 };

describe('なぞり始め startsHorizontalDrag', () => {
  it('横に遊びの8pxだけ動いたら、なぞり始めと読む', () => {
    // 境界は含む。**期待値は literal で置く**（`docs/testing.md` 3章）。
    expect(startsHorizontalDrag(start, { x: 192, y: 200 })).toBe(true);
  });

  it('横の動きが遊びに届かなければ読まない', () => {
    expect(startsHorizontalDrag(start, { x: 193, y: 200 })).toBe(false);
  });

  it('縦の動きのほうが大きければ読まない', () => {
    // FR-04: 一覧は縦に長く、縦は送りの操作である。
    expect(startsHorizontalDrag(start, { x: 180, y: 230 })).toBe(false);
  });
});

describe('なぞっている間の位置 swipeOffsetOf', () => {
  it('閉じた行は、左へ引いた分だけ動く', () => {
    expect(swipeOffsetOf(false, start, { x: 150, y: 200 })).toBe(-50);
  });

  it('右へは引けない', () => {
    // `削除` は右端にしか無い。
    expect(swipeOffsetOf(false, start, { x: 260, y: 200 })).toBe(0);
  });

  it('開いた行は、開いた位置から引いた分だけ動く', () => {
    expect(swipeOffsetOf(true, start, { x: 240, y: 200 })).toBe(-48);
  });

  it('開いた位置の88pxを越えて引いた分は、3分の1だけ動く', () => {
    expect(swipeOffsetOf(false, start, { x: 82, y: 200 })).toBe(-98);
  });
});

describe('離したときの落ち着き先 settlesRevealed', () => {
  it('削除の半分の44pxを越えて見えていれば開く', () => {
    expect(settlesRevealed(-45)).toBe(true);
  });

  it('ちょうど半分なら開かない', () => {
    expect(settlesRevealed(-44)).toBe(false);
  });
});

// ---- 行のタップ（B-55）----

/** タップを見る側の押した点。遊びが小さいので、原点から離した見分けのつく1点に固定する。 */
const pressed = { x: 10, y: 10 };

describe('行のタップ isTap', () => {
  it('押した点から動いていなければタップと読む', () => {
    // FR-05 / B-55 規則15: 行のタップで編集を開く（`docs/screen-design.md` 2章 `pantry --> edit`）。
    expect(isTap(pressed, { x: 10, y: 10 })).toBe(true);
  });

  it('縦横どちらの移動も8px未満ならタップと読む', () => {
    // B-55 規則15: 指は静止しない。わずかな揺れでタップが失われると、編集を開けない回が出る。
    expect(isTap(pressed, { x: 17, y: 3 })).toBe(true);
  });

  it('横にちょうど8px動いたらタップと読まない', () => {
    // B-55 規則15: 境界は含まない。
    expect(isTap(pressed, { x: 18, y: 10 })).toBe(false);
  });

  it('縦に逆向きへちょうど8px動いてもタップと読まない', () => {
    // B-55 規則15: 縦も横と同じ遊びで、向きは問わない（一覧は縦に長く、送りの操作がある）。
    expect(isTap(pressed, { x: 10, y: 2 })).toBe(false);
  });

  it('なぞり始めと読む動きはタップと読まない', () => {
    // B-55 規則15: なぞりと編集の画面が同時に起きない。
    const dragged = { x: 2, y: 10 };

    expect([isTap(pressed, dragged), startsHorizontalDrag(pressed, dragged)]).toEqual([
      false,
      true,
    ]);
  });
});
