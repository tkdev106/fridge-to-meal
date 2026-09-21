/**
 * タブの見た目（B-41 設計 6章 規則1〜4・7）。**node のまま**で足りる純粋関数であり、
 * jsdom を宣言しない（`docs/testing.md` 5章）。
 *
 * **比較はすべて `tabStyleOf(true)` と `tabStyleOf(false)` の戻り値どうしで書く。**
 * 太さ・線・色の**具体値を期待値に書かない** — `'700'` か `'bold'` かは書き方の違いであり、
 * 留めると変えただけで赤くなる（`docs/testing.md` 3章 / ADR-052 結果2）。
 *
 * **実際の見え方・レイアウト・コントラスト比はここで見られない**（B-41 設計 8章）。
 */

import { describe, expect, it } from 'vitest';
import { tabStyleOf } from '../../src/navigation/TabAppearance.js';

describe('タブの見た目 TabAppearance', () => {
  it('選んでいるタブと選んでいないタブで文字の太さが変わる', () => {
    // B-41 設計 6章 規則1（NFR-17 の構え）: 太さは色ではないので、
    // これ1つで「色以外の手がかりが1つ以上ある」が立つ。
    expect(tabStyleOf(true).fontWeight).not.toBe(tabStyleOf(false).fontWeight);
  });

  it('選んでいるタブと選んでいないタブで上辺の線の色が変わる', () => {
    // 同 規則2: 手がかりを1つに賭けず、帯の中身に近い側（上辺）に線の印を出す。
    expect(tabStyleOf(true).borderTopColor).not.toBe(tabStyleOf(false).borderTopColor);
  });

  it('上辺の線の太さは選んでも変わらない', () => {
    // 同 規則4 / NFR-14: 太さが変わると、タブを移るたびに帯の高さが動いて押し間違える。
    expect(tabStyleOf(true).borderTopWidth).toBe(tabStyleOf(false).borderTopWidth);
  });

  it('上辺の線は、見えない指定になっていない', () => {
    // 同 規則2・規則4 の土台。**`border-top-style` の既定は `none`** で、そのとき
    // `border-top-width` は 0 に計算される — 線の色だけを変えても印は出ず、
    // 規則4 が確保したはずの場所も消える。**どちらの見た目でも線を引く指定であること**を見る。
    // 具体の指定（`'solid'` か否か）は書き方なので断定しない（ADR-052 結果2）。
    expect(tabStyleOf(true).borderTopStyle).not.toBeUndefined();
    expect(tabStyleOf(true).borderTopStyle).not.toBe('none');
    expect(tabStyleOf(false).borderTopStyle).not.toBeUndefined();
    expect(tabStyleOf(false).borderTopStyle).not.toBe('none');
  });

  it('選んでいないタブも上辺の線の場所を確保する', () => {
    // 同 規則4: 出さないのは**色**であって、場所は確保する（`transparent`）。
    expect(tabStyleOf(false).borderTopWidth).not.toBeUndefined();
  });

  it('どちらの見た目にも文字の太さが定まっている', () => {
    // 同 規則4: 帯の寸法を既定任せにしない。片方だけ明示すると、
    // 既定の太さが変わった回に規則1 の差だけが黙って消える。
    expect(tabStyleOf(true).fontWeight).not.toBeUndefined();
    expect(tabStyleOf(false).fontWeight).not.toBeUndefined();
  });

  it('文字色は選んでも変わらない', () => {
    // 同 規則3 / NFR-16: 区別に色を使わないので、新しいコントラスト比が生まれない。
    expect(tabStyleOf(true).color).toBe(tabStyleOf(false).color);
  });

  it('背景色は選んでも変わらない', () => {
    // 同 規則3 / NFR-16。配色は未選定である（`docs/screen-design.md` 冒頭・論点3）。
    expect(tabStyleOf(true).backgroundColor).toBe(tabStyleOf(false).backgroundColor);
  });

  it('同じ「選ばれているか」には同じ見た目を返す', () => {
    // 同 規則7: 見た目は「選ばれているか」だけで決まり、`TabId` ごとに変わらない。
    expect(tabStyleOf(true)).toEqual(tabStyleOf(true));
    expect(tabStyleOf(false)).toEqual(tabStyleOf(false));
  });
});
