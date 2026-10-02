// @vitest-environment jsdom
/**
 * 食材名の欄と直下の補完の一覧 `IngredientNameCombobox`（B-66 設計 5章 / 6章 規則4・10〜13 /
 * ADR-052 / `docs/testing.md` 4.1）。
 *
 * 絞り込みとキーごとの遷移の網羅は `IngredientNameCompletion.test.ts` の持ち分であり、ここは
 * **描いた木に何が出るか**（一覧・ARIA・欄の値）と、**キーと押下の既定の動作を止めたか**だけを見る。
 *
 * - **既定の動作を止めたか** … `fireEvent.keyDown` / `fireEvent.mouseDown` の戻り値（止めたら `false`）。
 *   jsdom は欄での Enter から `<form>` の送信を起こさないため、送信そのものは観ない（設計 10章）
 * - **欄の値** … テスト側の器が `useState` で持つ値が、欄にそのまま描かれる
 * - **一覧の名称** … `option` の役割で引いた行の文字。名称だけを描く（設計 規則13）
 *
 * **class も DOM の形も辿らない**（ADR-052 結果3）。見た目（規則14）はここで観ない。
 */

import { useId, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../../support/dom/renderComponent.js';
import { IngredientNameCombobox } from '../../../src/features/pantry/IngredientNameCombobox.js';

const ingredientNames = ['豚こま肉', 'にんじん', '牛こま肉'] as const;

/**
 * 値を持つ小さな器。**欄の値は部品の外が持つ**（設計 5章 `value` / `onChange`）ので、
 * 打った値と選んだ名称が欄に描き戻されるところまでをここで閉じる。
 */
function Harness({ initialValue = '' }: { readonly initialValue?: string | undefined }) {
  const id = useId();
  const [value, setValue] = useState(initialValue);

  return (
    <IngredientNameCombobox
      id={id}
      value={value}
      onChange={setValue}
      ingredientNames={ingredientNames}
    />
  );
}

function renderCombobox(initialValue?: string) {
  return render(<Harness initialValue={initialValue} />);
}

function field(): HTMLInputElement {
  return screen.getByRole('combobox') as HTMLInputElement;
}

function type(value: string): void {
  fireEvent.change(field(), { target: { value } });
}

function press(key: string): boolean {
  return fireEvent.keyDown(field(), { key });
}

/** 一覧が木に無いこと。**隠しているだけでも見つける**ために `hidden: true` で引く（規則13）。 */
function listbox(): HTMLElement | null {
  return screen.queryByRole('listbox', { hidden: true });
}

function optionNames(): readonly string[] {
  return screen.getAllByRole('option').map((option) => option.textContent ?? '');
}

function optionAt(index: number): HTMLElement {
  const found = screen.getAllByRole('option').at(index);
  if (found === undefined) throw new Error(`${index} 番目の行が無い`);

  return found;
}

/** 行を押す。**押下 → click の順に2つ起こす**（指でもマウスでも押すことはこの2つで届く）。 */
function pressOption(index: number): void {
  const option = optionAt(index);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

describe('食材名の欄 IngredientNameCombobox の一覧', () => {
  it('打つと、合う名称が欄の直下の一覧に出る', () => {
    renderCombobox();

    type('こま');

    // 規則1・4 / FR-02: 打つと開き、部分一致した名称がサーバの並びのまま出る。
    expect(optionNames()).toEqual(['豚こま肉', '牛こま肉']);
  });

  it('焦点が当たっただけでは一覧を出さない', () => {
    renderCombobox('こま');

    fireEvent.focus(field());

    // 規則4: 開くのは打った（値が変わった）ときだけ。
    expect(listbox()).toBeNull();
  });

  it('合う名称が無ければ打っても一覧を出さない', () => {
    renderCombobox();

    type('ゴーヤ');

    // 規則4: 一覧が出るのは合う名称が1件以上のときだけ。
    expect(listbox()).toBeNull();
  });

  it('打った直後は、どの行も選ばれていない', () => {
    renderCombobox();

    type('こま');

    // 規則5: 開いた直後に先頭を選ぶと、Enter が選択に吸われて打った名前で保存できなくなる（FR-03 / FR-08）。
    expect(field().getAttribute('aria-activedescendant')).toBeNull();
    expect(
      screen
        .getAllByRole('option')
        .filter((option) => option.getAttribute('aria-selected') === 'true'),
    ).toEqual([]);
  });
});

describe('食材名の欄 IngredientNameCombobox のキー操作', () => {
  it('行を選んでいないときの Enter は既定の動作を止めない', () => {
    renderCombobox();
    type('こま');

    // 規則5 / FR-08: 選んでいない Enter は `<form>` の送信（「保存してもう1件」）に落ちる。
    expect(press('Enter')).toBe(true);
  });

  it('↓で選んだ行を欄の aria-activedescendant が指す', () => {
    renderCombobox();
    type('こま');

    press('ArrowDown');

    // 規則6・13。
    expect(field().getAttribute('aria-activedescendant')).toBe(optionAt(0).id);
  });

  it('選んでいる行だけが aria-selected を真にする', () => {
    renderCombobox();
    type('こま');

    press('ArrowDown');

    // 規則13。
    expect(
      screen
        .getAllByRole('option')
        .filter((option) => option.getAttribute('aria-selected') === 'true')
        .map((option) => option.textContent),
    ).toEqual(['豚こま肉']);
  });

  it('↓は既定の動作を止める', () => {
    renderCombobox();
    type('こま');

    // 規則6: カーソル移動を止める。
    expect(press('ArrowDown')).toBe(false);
  });

  it('打ち直すと選んでいた行は外れる', () => {
    renderCombobox();
    type('こま');
    press('ArrowDown');

    type('こま肉');

    // 規則4: 値が変わると選んでいる行は無しに戻る。
    expect(field().getAttribute('aria-activedescendant')).toBeNull();
  });

  it('行を選んで Enter を押すと、その名称が欄に入る', () => {
    renderCombobox();
    type('こま');
    press('ArrowDown');

    press('Enter');

    // 規則7 / FR-02: 選んだ名称をそのまま欄に入れる。
    expect(field().value).toBe('豚こま肉');
  });

  it('行を選んで Enter を押すと一覧が閉じる', () => {
    renderCombobox();
    type('こま');
    press('ArrowDown');

    press('Enter');

    // 規則7。
    expect(listbox()).toBeNull();
  });

  it('行を選んでいるときの Enter は既定の動作を止める', () => {
    renderCombobox();
    type('こま');
    press('ArrowDown');

    // 規則7 / FR-08: 選んだ回の Enter は送信に落とさない。
    expect(press('Enter')).toBe(false);
  });

  it('かなを変換している間の Enter では、選んでいる行の名称を欄に入れない', () => {
    renderCombobox();
    type('こま');
    press('ArrowDown');

    // FR-03: 変換を確定する Enter が行の選択を兼ねると、打ちかけの名前が置き換わる。
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });

    expect(field()).toHaveProperty('value', 'こま');
  });

  it('Esc で一覧が閉じる', () => {
    renderCombobox();
    type('こま');

    press('Escape');

    // 規則8。
    expect(listbox()).toBeNull();
  });

  it('Esc を押しても欄の値は消えない', () => {
    renderCombobox();
    type('こま');

    press('Escape');

    // 規則8 / NFR-15: 打ち直しを強いない。
    expect(field().value).toBe('こま');
  });

  it('Tab で一覧が閉じる', () => {
    renderCombobox();
    type('こま');
    press('ArrowDown');

    press('Tab');

    // 規則9。
    expect(listbox()).toBeNull();
  });

  it('行を選んでいても Tab では欄の値が変わらない', () => {
    renderCombobox();
    type('こま');
    press('ArrowDown');

    press('Tab');

    // 規則9 / FR-03: 選んでいる行を欄に入れず、打った名前をそのまま残す。
    expect(field().value).toBe('こま');
  });
});

describe('食材名の欄 IngredientNameCombobox の焦点と押下', () => {
  it('焦点が外れると一覧が閉じる', () => {
    renderCombobox();
    type('こま');

    fireEvent.blur(field());

    // 規則9。
    expect(listbox()).toBeNull();
  });

  it('行を選んでいても焦点が外れたときは欄の値が変わらない', () => {
    renderCombobox();
    type('こま');
    press('ArrowDown');

    fireEvent.blur(field());

    // 規則9 / FR-03。
    expect(field().value).toBe('こま');
  });

  it('行を押すと、その名称が欄に入る', () => {
    renderCombobox();
    type('こま');

    pressOption(1);

    // 規則10 / FR-02。
    expect(field().value).toBe('牛こま肉');
  });

  it('行を押すと一覧が閉じる', () => {
    renderCombobox();
    type('こま');

    pressOption(1);

    // 規則10。
    expect(listbox()).toBeNull();
  });

  it('行を押しても欄の焦点は外れない', () => {
    renderCombobox();
    type('こま');

    // 規則10 / NFR-15: 押下の既定の動作（焦点の移動）を止める。
    expect(fireEvent.mouseDown(optionAt(1))).toBe(false);
  });
});

describe('食材名の欄 IngredientNameCombobox の ARIA', () => {
  it('欄は aria-autocomplete="list" の combobox である', () => {
    renderCombobox();

    // 規則13: 役割は `role="combobox"` の明示で得る。
    expect(field().getAttribute('aria-autocomplete')).toBe('list');
  });

  it('一覧が出ていないとき aria-expanded は偽である', () => {
    renderCombobox();

    // 規則13。
    expect(field().getAttribute('aria-expanded')).toBe('false');
  });

  it('一覧が出ている間は aria-expanded が真である', () => {
    renderCombobox();

    type('こま');

    // 規則13。
    expect(field().getAttribute('aria-expanded')).toBe('true');
  });

  it('一覧が出ている間は、欄の aria-controls が一覧を指す', () => {
    renderCombobox();

    type('こま');

    // 規則13。
    expect(field().getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
  });

  it('同じ部品を2つ描いても、それぞれの欄は自分の一覧を指す', () => {
    render(
      <>
        <Harness />
        <Harness />
      </>,
    );
    const [first, second] = screen.getAllByRole('combobox');
    if (first === undefined || second === undefined) throw new Error('欄が2つ無い');

    fireEvent.change(first, { target: { value: 'こま' } });
    fireEvent.change(second, { target: { value: 'こま' } });

    // 規則13 / B-50c 規則8: `id` を固定の文字列にすると、片方の欄がもう片方の一覧を指す。
    const listboxIds = screen.getAllByRole('listbox').map((found) => found.id);
    const firstControls = first.getAttribute('aria-controls');
    const secondControls = second.getAttribute('aria-controls');
    expect(firstControls).not.toBe(secondControls);
    expect(listboxIds).toContain(firstControls);
    expect(listboxIds).toContain(secondControls);
  });
});
