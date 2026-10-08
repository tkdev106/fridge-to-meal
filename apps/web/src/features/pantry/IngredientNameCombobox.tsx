/**
 * 食材名の欄と、その直下に出る補完の一覧（B-66 設計 5章 / 6章 規則4・10〜15）。
 *
 * `<datalist>` はブラウザが描くため見た目を当てられない（ADR-074）。**依存を足さずに**
 * WAI-ARIA の combobox の型で一覧を自前で描く。どの名称が合うか・どのキーでどう移るかの判断は
 * `IngredientNameCompletion.ts` が持ち、ここはそれを当てて描くだけである。
 *
 * **欄の値は外が持つ**（`value` / `onChange`）。部品が値を書き換えるのは**行を選んだときだけ**で、
 * 補完に無い名前・選ばなかった名前もそのまま外に残る（規則11 / FR-03）。名称が空の列なら一覧が
 * 出ないだけで、欄はそのまま効く（規則12）。
 *
 * **見た目の値は `IngredientNameCombobox.module.css` にだけ置き**、ここには class 名しか書かない
 * （ADR-055 決定1）。**日本語を1つも持たない** — 欄の名前（`<label>`）は `StockItemForm` が持つ。
 */

import type { ChangeEvent, JSX, KeyboardEvent, MouseEvent } from 'react';
import { useId, useState } from 'react';
import type { CompletionKey, CompletionState } from './IngredientNameCompletion.js';
import {
  CLOSED_COMPLETION,
  completionStepOf,
  matchingIngredientNamesOf,
} from './IngredientNameCompletion.js';
import styles from './IngredientNameCombobox.module.css';

export type IngredientNameComboboxProps = {
  /** 欄の id。`<label htmlFor>` は `StockItemForm` が持つ */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** `ingredientNameOptionsOf` の結果をそのまま */
  ingredientNames: readonly string[];
  autoFocus?: boolean;
  /** 名前が空の断りが出ている間（B-65 規則10）。枠を赤にし、読み上げにも誤りと渡す */
  invalid?: boolean;
  /** 欄に打てる字数の上限（NFR-19）。補完の行を選んで入る値は切らない */
  maxLength?: number;
};

/** 遷移を持つキー。これ以外のキーは既定の動作のまま通す。 */
const COMPLETION_KEYS: ReadonlySet<string> = new Set<CompletionKey>([
  'ArrowDown',
  'ArrowUp',
  'Enter',
  'Escape',
  'Tab',
]);

function isCompletionKey(key: string): key is CompletionKey {
  return COMPLETION_KEYS.has(key);
}

export function IngredientNameCombobox({
  id,
  value,
  onChange,
  ingredientNames,
  autoFocus = false,
  invalid = false,
  maxLength,
}: IngredientNameComboboxProps): JSX.Element {
  // 一覧と行の識別子。**固定の文字列にしない**（規則13 / B-50c 規則8）— 同じ部品が2つ
  // 描かれた回に、片方の欄がもう片方の一覧を指す。
  const listboxId = useId();
  const [completion, setCompletion] = useState<CompletionState>(CLOSED_COMPLETION);

  const matches = matchingIngredientNamesOf(ingredientNames, value);
  // 一覧が出るのは「開いている」かつ合う名称が1件以上のときだけ（規則4）。
  const expanded = completion.open && matches.length > 0;
  const activeIndex = expanded ? completion.activeIndex : null;

  function optionIdOf(index: number): string {
    return `${listboxId}-option-${index}`;
  }

  /** 名称を選ぶ。欄に**そのまま**入れて閉じる（規則7・10）。 */
  function select(name: string) {
    onChange(name);
    setCompletion(CLOSED_COMPLETION);
  }

  /** 打つと開き、選んでいる行は無しに戻る（規則4）。焦点が当たっただけでは開かない。 */
  function change(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
    setCompletion({ open: true, activeIndex: null });
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    // かなを変換している間のキーは変換の操作であって、補完の操作ではない。Enter が変換の確定と
    // 行の選択を兼ねると、打ちかけの名前が行の名称に置き換わる（FR-03）。
    if (event.nativeEvent.isComposing) return;
    if (!isCompletionKey(event.key)) return;

    const step = completionStepOf(completion, event.key, matches);
    // 止めるのは遷移が止めると言った回だけ（規則5・7・8）。選んでいない Enter は `<form>` の
    // 送信（「保存してもう1件」）へ落ちる（FR-08）。
    if (step.handled) event.preventDefault();
    if (step.selected !== null) onChange(step.selected);
    setCompletion(step.state);
  }

  /** 焦点が外れたら選ばずに閉じる（規則9 / FR-03）。 */
  function blur() {
    setCompletion(CLOSED_COMPLETION);
  }

  /**
   * 行の押下の既定の動作（焦点の移動）を止める（規則10 / NFR-15）。止めないと欄の焦点が
   * 外れて `blur` が一覧を閉じ、click が届く前に行が木から消える。
   */
  function keepFocus(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
  }

  return (
    <div className={styles.combobox}>
      {/* 役割は `role="combobox"` で**明示する**（規則13）— 一覧が0件の回も役割が変わらない。 */}
      <input
        id={id}
        className={invalid ? `${styles.input} ${styles.inputInvalid}` : styles.input}
        aria-invalid={invalid || undefined}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listboxId : undefined}
        aria-activedescendant={activeIndex === null ? undefined : optionIdOf(activeIndex)}
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={maxLength}
        value={value}
        onChange={change}
        onKeyDown={keyDown}
        onBlur={blur}
      />

      {/* 一覧は出ている間だけ木に置く（規則13）。**行は名称のほかに何も描かない** —
          ラベルを足すと未確定の文言が入り込む（B-50c 規則9）。**行を `<button>` にしない** —
          焦点は欄に残したまま `aria-activedescendant` で指す型であり、行は焦点を受け取らない。 */}
      {expanded && (
        <ul id={listboxId} className={styles.listbox} role="listbox">
          {matches.map((name, index) => (
            <li
              key={name}
              id={optionIdOf(index)}
              className={
                index === activeIndex ? `${styles.option} ${styles.optionActive}` : styles.option
              }
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={keepFocus}
              onClick={() => select(name)}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
