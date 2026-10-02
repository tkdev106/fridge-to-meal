/**
 * 食材名の補完の絞り込みとキー操作の遷移 `IngredientNameCompletion`（B-66 設計 5章 /
 * 6章 規則1〜3・5〜9）。
 *
 * 欄と一覧を描くこと（ARIA・押した行が欄に入る・焦点が外れると閉じる）は
 * `IngredientNameCombobox.test.tsx` の持ち分であり、ここは**どの名称が合うか**と
 * **どのキーでどの状態へ移り、何を選び、既定の動作を止めるか**だけを見る。
 * 純粋関数なので node で回る（`docs/testing.md` 4.1）。
 */

import { describe, expect, it } from 'vitest';
import type { CompletionState } from '../../../src/features/pantry/IngredientNameCompletion.js';
import {
  CLOSED_COMPLETION,
  completionStepOf,
  matchingIngredientNamesOf,
} from '../../../src/features/pantry/IngredientNameCompletion.js';

const porkAndBeef = ['豚こま肉', 'にんじん', '牛こま肉'] as const;

describe('打ちかけの文字に合う名称 matchingIngredientNamesOf', () => {
  it('打ちかけの文字を名称の途中に含むものも合う', () => {
    // 規則1: 部分一致。前方一致では `こま` から `豚こま肉` は出ない（原本の例）。
    expect(matchingIngredientNamesOf(porkAndBeef, 'こま')).toEqual(['豚こま肉', '牛こま肉']);
  });

  it('打ちかけの文字の前後の空白を落として比べる', () => {
    // 規則1: 比べる前に前後の空白だけを落とす。
    expect(matchingIngredientNamesOf(porkAndBeef, '  こま  ')).toEqual(['豚こま肉', '牛こま肉']);
  });

  it('大文字と小文字を畳まない', () => {
    // 規則1 / ADR-063 4-B / C-6: 表記ゆれは吸収しない。
    expect(matchingIngredientNamesOf(['Tofu'], 'tofu')).toEqual([]);
  });

  it('全角と半角を畳まない', () => {
    // 規則1 / ADR-063 4-B / C-6。
    expect(matchingIngredientNamesOf(['ＴＯＦＵ'], 'TOFU')).toEqual([]);
  });

  it('ひらがなとカタカナを畳まない', () => {
    // 規則1 / ADR-063 4-B / C-6。
    expect(matchingIngredientNamesOf(['ニンジン'], 'にんじん')).toEqual([]);
  });

  it('打ちかけの文字が空なら1件も合わない', () => {
    // 規則2 / FR-02「入力途中で」: 何も打っていなければ一覧は出ない。
    expect(matchingIngredientNamesOf(['にんじん'], '')).toEqual([]);
  });

  it('打ちかけの文字が空白だけなら1件も合わない', () => {
    // 規則2: 空白だけは空として読む。
    expect(matchingIngredientNamesOf(['にんじん'], '   ')).toEqual([]);
  });

  it('名称の先頭で合うものを前に寄せず、渡された並びのまま返す', () => {
    // 規則3 / ADR-063 決定4: 並びを決めるのはサーバである。
    expect(matchingIngredientNamesOf(['豚こま肉', 'こま切れ'], 'こま')).toEqual([
      '豚こま肉',
      'こま切れ',
    ]);
  });

  it('合う名称の件数に上限を置かない', () => {
    const names = [
      '牛肉',
      '豚肉',
      '鶏肉',
      '合いびき肉',
      '豚こま肉',
      '牛こま肉',
      '鶏むね肉',
      '鶏もも肉',
      '豚ばら肉',
      '牛すね肉',
      'ささみ肉',
      '手羽肉',
    ];

    // 規則3 / B-50c 規則5: 件数を切らない。
    expect(matchingIngredientNamesOf(names, '肉')).toEqual([
      '牛肉',
      '豚肉',
      '鶏肉',
      '合いびき肉',
      '豚こま肉',
      '牛こま肉',
      '鶏むね肉',
      '鶏もも肉',
      '豚ばら肉',
      '牛すね肉',
      'ささみ肉',
      '手羽肉',
    ]);
  });

  it('名称が空の列なら何を打っても1件も合わない', () => {
    // 規則12 / FR-03: 取れなかった回・まだの回は空の列であり、一覧が出ないだけである。
    expect(matchingIngredientNamesOf([], 'に')).toEqual([]);
  });
});

/** 3件の合う名称。**期待する state は literal で別に置く**（`docs/testing.md` 3章）。 */
const matches = ['豚こま肉', '牛こま肉', 'こま切れ'] as const;

function openAt(activeIndex: number | null): CompletionState {
  return { open: true, activeIndex };
}

describe('キー操作の遷移 completionStepOf', () => {
  it('閉じているとき↓を押すと、開いて先頭の行を選ぶ', () => {
    // 規則6: 閉じていて合う名称があれば開いて先頭を選び、カーソル移動を止める。
    expect(completionStepOf(CLOSED_COMPLETION, 'ArrowDown', matches)).toEqual({
      state: { open: true, activeIndex: 0 },
      selected: null,
      handled: true,
    });
  });

  it('閉じていて合う名称が無いとき↓を押しても開かない', () => {
    // 規則4・6: 一覧が出るのは合う名称が1件以上のときだけ。
    expect(completionStepOf(CLOSED_COMPLETION, 'ArrowDown', []).state.open).toBe(false);
  });

  it('開いていて行を選んでいないとき↓を押すと、先頭の行を選ぶ', () => {
    // 規則5・6: 開いた直後は行を選んでおらず、↓で先頭へ。
    expect(completionStepOf(openAt(null), 'ArrowDown', matches).state.activeIndex).toBe(0);
  });

  it('↓を押すと次の行を選ぶ', () => {
    // 規則6。
    const step = completionStepOf(openAt(0), 'ArrowDown', matches);

    expect(step.state.activeIndex).toBe(1);
    expect(step.handled).toBe(true);
  });

  it('末尾の行で↓を押すと先頭の行に戻る', () => {
    // 規則6: 末尾からは先頭へ。
    expect(completionStepOf(openAt(2), 'ArrowDown', matches).state.activeIndex).toBe(0);
  });

  it('↑を押すと前の行を選ぶ', () => {
    // 規則6。
    const step = completionStepOf(openAt(1), 'ArrowUp', matches);

    expect(step.state.activeIndex).toBe(0);
    expect(step.handled).toBe(true);
  });

  it('先頭の行で↑を押すと末尾の行に移る', () => {
    // 規則6: 先頭からは末尾へ。
    expect(completionStepOf(openAt(0), 'ArrowUp', matches).state.activeIndex).toBe(2);
  });

  it('行を選んでいないとき↑を押すと末尾の行を選ぶ', () => {
    // 規則6: 選んでいない（無し）からも末尾へ。
    expect(completionStepOf(openAt(null), 'ArrowUp', matches).state.activeIndex).toBe(2);
  });

  it('行を選んでいるとき Enter を押すと、その名称をそのまま返して閉じる', () => {
    // 規則7 / FR-02: 選んだ名称を欄の値にそのまま入れ、一覧を閉じる。
    const step = completionStepOf(openAt(1), 'Enter', matches);

    expect(step.selected).toBe('牛こま肉');
    expect(step.state.open).toBe(false);
  });

  it('行を選んでいるときの Enter は既定の動作を止める', () => {
    // 規則7 / FR-08: 選んだ回の Enter は送信に落とさない。
    expect(completionStepOf(openAt(1), 'Enter', matches).handled).toBe(true);
  });

  it('開いていても行を選んでいないときの Enter は既定の動作を止めない', () => {
    // 規則5 / FR-08 / FR-03: 選んでいない Enter は「保存してもう1件」に落ちる。
    const step = completionStepOf(openAt(null), 'Enter', matches);

    expect(step.handled).toBe(false);
    expect(step.selected).toBeNull();
  });

  it('選んだあとの2度目の Enter は既定の動作を止めない', () => {
    const afterSelecting = completionStepOf(openAt(1), 'Enter', matches).state;

    // 規則7: 2度目の Enter で送信に落ちる。
    const step = completionStepOf(afterSelecting, 'Enter', matches);

    expect(step.handled).toBe(false);
    expect(step.selected).toBeNull();
  });

  it('開いているとき Esc を押すと、何も選ばずに閉じる', () => {
    // 規則8 / NFR-15: 閉じるだけで、欄の値は変えない（何も選ばない）。
    const step = completionStepOf(openAt(1), 'Escape', matches);

    expect(step.state.open).toBe(false);
    expect(step.selected).toBeNull();
    expect(step.handled).toBe(true);
  });

  it('閉じているときの Esc は既定の動作を止めない', () => {
    // 規則8: 閉じていれば何もしない。
    expect(completionStepOf(CLOSED_COMPLETION, 'Escape', matches).handled).toBe(false);
  });

  it('行を選んでいても Tab では何も選ばずに閉じる', () => {
    // 規則9 / FR-03: 選んでいる行を欄に入れず、打った名前をそのまま残す。
    const step = completionStepOf(openAt(1), 'Tab', matches);

    expect(step.state.open).toBe(false);
    expect(step.selected).toBeNull();
  });

  it('Tab は既定の動作を止めない', () => {
    // 規則9: 焦点は次の欄へ移る。
    expect(completionStepOf(openAt(1), 'Tab', matches).handled).toBe(false);
  });
});
