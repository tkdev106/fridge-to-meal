import { describe, expect, it } from 'vitest';
import { isDeleteSwipe } from '../../../src/features/pantry/SwipeGesture.js';

/** 押した点の標本。どこから始めても結論は動かないので、原点から離した1点に固定する。 */
const start = { x: 100, y: 200 };

describe('削除のスワイプ isDeleteSwipe', () => {
  it('横に大きく動いたら削除のスワイプと読む', () => {
    // FR-06 / `docs/screen-design.md` 5章: 削除は行のスワイプである。
    expect(isDeleteSwipe(start, { x: 20, y: 200 })).toBe(true);
  });

  it('向きが逆でも削除のスワイプと読む', () => {
    // B-23: **`docs/screen-design.md` 5章 は向きを定めていない。** 片方だけを受け取ると、
    // 逆になぞった回は何も起きず、確認も取り消しも無い画面では理由を知る手がかりが残らない。
    expect(isDeleteSwipe(start, { x: 180, y: 200 })).toBe(true);
  });

  it('横の動きが足りなければ読まない', () => {
    // B-23: 触れただけ・わずかに滑っただけで消えない。確認を出さない以上（同 5章）、
    // なぞったと言える長さを要求する側で守る。
    expect(isDeleteSwipe(start, { x: 137, y: 200 })).toBe(false);
  });

  it('ちょうど64だけ横に動いたら読む', () => {
    // B-23: 境界は含む。**期待値は literal で置く**（`docs/testing.md` 3章）。
    expect(isDeleteSwipe(start, { x: 164, y: 200 })).toBe(true);
  });

  it('縦の動きのほうが大きければ読まない', () => {
    // B-23 / FR-04: 一覧は縦に長く、縦になぞるのは送りの操作である。斜めに流れた送りで
    // 行が消えると、取り消しの無い操作が事故で起きる。
    expect(isDeleteSwipe(start, { x: 200, y: 320 })).toBe(false);
  });

  it('押した点から動いていなければ読まない', () => {
    // B-23: 行に触れるだけの操作（将来の編集への入口）と、消す操作を分ける。
    expect(isDeleteSwipe(start, start)).toBe(false);
  });
});
