/**
 * 食材名の補完の絞り込みとキー操作の遷移（B-66 設計 5章 / 6章 規則1〜3・5〜9）。
 *
 * **React も DOM の型も日本語も持たない**（先行 `SwipeGesture.ts` / `RowOperations.ts`）。
 * 欄と一覧を描くのは `IngredientNameCombobox.tsx` で、そちらはここが返した遷移を当てるだけである。
 */

/** 補完の一覧の開閉と、選んでいる行（`aria-activedescendant` が指す行）。 */
export type CompletionState = { readonly open: boolean; readonly activeIndex: number | null };

/** 閉じていて、どの行も選んでいない状態。 */
export const CLOSED_COMPLETION: CompletionState = { open: false, activeIndex: null };

/** 1件も合わないこと。 */
const NO_MATCHES: readonly string[] = [];

/**
 * 打ちかけの文字に合う名称を、渡された並びのまま返す。
 *
 * - **部分一致**で比べる（規則1）。前方一致では原本の例（`こま` → `豚こま肉`）が出ない
 * - 比べる前に打ちかけの文字の**前後の空白だけ**を落とす。大小・全半角・かなは畳まない
 *   （ADR-063 4-B / C-6。表記ゆれは吸収しない）
 * - 空（空白だけを含む）なら1件も合わない（規則2 / FR-02「入力途中で」）
 * - **並べ替えず、件数も切らない**（規則3 / ADR-063 決定4）— 並びを決めるのはサーバである
 */
export function matchingIngredientNamesOf(
  ingredientNames: readonly string[],
  query: string,
): readonly string[] {
  const trimmed = query.trim();
  if (trimmed === '') return NO_MATCHES;

  return ingredientNames.filter((name) => name.includes(trimmed));
}

export type CompletionKey = 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Escape' | 'Tab';

export type CompletionStep = {
  readonly state: CompletionState;
  /** 欄に入れる名称。選ばなかった回は null */
  readonly selected: string | null;
  /** 真なら既定の動作（送信など）を止める */
  readonly handled: boolean;
};

/** 何もしない遷移。状態を変えず、何も選ばず、既定の動作も止めない。 */
function unhandled(state: CompletionState): CompletionStep {
  return { state, selected: null, handled: false };
}

/** 行を選び直す遷移。開いて、その行を選び、既定の動作（カーソル移動）を止める（規則6）。 */
function activate(activeIndex: number): CompletionStep {
  return { state: { open: true, activeIndex }, selected: null, handled: true };
}

/**
 * キー1つでどの状態へ移り、何を選び、既定の動作を止めるか（規則5〜9）。
 *
 * **開いた直後は行を選んでいない**（規則5）ので、選んでいない Enter は止めずに `<form>` の
 * 送信（「保存してもう1件」）へ落とす — 先頭を自動で選ぶと Enter が選択に吸われ、補完に無い
 * 名前を打って Enter で保存できなくなる（FR-03 / FR-08）。
 */
export function completionStepOf(
  state: CompletionState,
  key: CompletionKey,
  matches: readonly string[],
): CompletionStep {
  const last = matches.length - 1;

  switch (key) {
    case 'ArrowDown': {
      // 合う名称が無ければ開かない（規則4）。閉じていれば先頭、開いていれば次、末尾からは先頭。
      if (last < 0) return unhandled(state);
      const current = state.open ? state.activeIndex : null;

      return activate(current === null || current >= last ? 0 : current + 1);
    }
    case 'ArrowUp': {
      // 前の行へ。先頭（または無し）からは末尾へ（規則6）。
      if (last < 0) return unhandled(state);
      const current = state.open ? state.activeIndex : null;

      return activate(current === null || current <= 0 || current > last ? last : current - 1);
    }
    case 'Enter': {
      // 開いていて行を選んでいるときだけ、その名称をそのまま返して閉じる（規則7）。
      const selected =
        state.open && state.activeIndex !== null ? matches[state.activeIndex] : undefined;
      if (selected === undefined) return unhandled(state);

      return { state: CLOSED_COMPLETION, selected, handled: true };
    }
    case 'Escape':
      // 開いていれば閉じるだけで、欄の値は変えない（規則8 / NFR-15）。
      if (!state.open) return unhandled(state);

      return { state: CLOSED_COMPLETION, selected: null, handled: true };
    case 'Tab':
      // 選ばずに閉じ、焦点は次の欄へ移す（規則9 / FR-03）。
      return unhandled(CLOSED_COMPLETION);
  }
}
