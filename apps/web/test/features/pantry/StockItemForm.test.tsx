// @vitest-environment jsdom
/**
 * 登録の画面 `StockItemForm` の**2つの保存と焦点**（B-39 設計 6章 規則8〜13 / 7章 /
 * ADR-052 / `docs/testing.md` 4.1）。
 *
 * **B-39 が足す振る舞いのぶんだけ**である（設計 2章「作らないもの」）。空欄の読み替えは
 * `StockItemFormValues.test.ts`、断りから案内を選ぶ判断は `RegisterFailureNotice.test.ts`、
 * B-12 が置いた既存の振る舞いの網羅は B-40 の持ち分であり、ここで二重に書かない。
 *
 * **仮の文言と記号を期待値に書かない**（ADR-052 結果2 / `docs/testing.md` 4.1 /
 * B-39 設計 規則15）。見出しも2つの保存の名札も「←」も案内も未確定である
 * （`docs/screen-design.md` 論点3）。観察はこの3つだけで行う。
 *
 * - **登録の口へ何が届いたか** … テストが持つ配列に積まれた入力。押した直後に同期で見える
 * - **欄に何が残っているか** … `queryByDisplayValue` に**テストが打った値**を当てる
 * - **どの操作を押すか** … `getAllByRole('button')` を**文書順の位置**で引く（`saveOperations`）
 *
 * **`vi.fn()` で呼び出し回数を数えない**（`docs/testing.md` 2章 / B-39 設計 8章）。送ったことも
 * 送っていないことも配列の中身で見る。**閉じたことはここでは観ない** —
 * 「一覧が出ている」で観るのは `PantryTab.test.tsx` の持ち分である。
 */

import { describe, expect, it } from 'vitest';
import type { RegisterStockItemInput } from '@fridge-to-meal/contract';
import { fireEvent, render, screen, waitFor } from '../../support/dom/renderComponent.js';
import { StockItemForm } from '../../../src/features/pantry/StockItemForm.js';
import type {
  RegisterStockItem,
  RegisterStockItemOutcome,
} from '../../../src/server/StockItemRequests.js';

/** 3欄に打つ標本。**欄を埋めるのに使う値であり、期待値は下の literal で別に置く。** */
const typedValues = { name: 'にんじん', amount: '2本', expiryDate: '2026-09-25' } as const;

/**
 * 一覧へ戻す口。**この観点では閉じたかどうかを観ない**（`docs/testing.md` 2章）— 呼ばれた
 * 回数を数えると実装詳細を握る。閉じたことは `PantryTab.test.tsx` が「一覧が出ている」で観る。
 */
const ignoreClose = () => {};

/**
 * 送られた登録を**配列に残す**口（先行 `PantryTab.test.tsx`）。`vi.fn()` で回数を数えず、
 * 配列の中身を状態として見る（`docs/testing.md` 2章）。
 */
function recordingRegister(
  registrations: RegisterStockItemInput[],
  outcome: RegisterStockItemOutcome,
): RegisterStockItem {
  return (input) => {
    registrations.push(input);

    return Promise.resolve(outcome);
  };
}

/**
 * 結末を**保留する**口。入力は受け取った時点で記録し、`settle()` を呼ぶまで返らない —
 * 「送っている間」（規則11）を**実時間を待たずに**作るためである（`docs/testing.md` 5章）。
 */
function pendingRegister(registrations: RegisterStockItemInput[]): {
  readonly register: RegisterStockItem;
  readonly settle: () => void;
} {
  let release: (() => void) | null = null;

  return {
    register: (input) => {
      registrations.push(input);

      return new Promise<RegisterStockItemOutcome>((resolve) => {
        release = () => resolve({ outcome: 'registered' });
      });
    },
    settle: () => {
      if (release === null) throw new Error('まだ送られていないので保留を解けない');

      release();
    },
  };
}

function renderForm(onRegister: RegisterStockItem) {
  render(<StockItemForm onRegister={onRegister} onClose={ignoreClose} />);
}

/**
 * 欄を役割と文書順で引く。3欄のうち `textbox` になるのは食材名と分量の2つで、期限は
 * `type="date"` なのでこの役割に入らない（先行 `PantryTab.test.tsx`）。
 *
 * **`instanceof HTMLInputElement` で絞らない** — 大域名を実行時に読むと、`tsc --build` が
 * `dist-test/` へ出した `.js` の側で `no-undef` に当たる（先行 `PantryTab.test.tsx` の
 * `ingredientNameField` と同じ理由）。
 */
function textboxAt(index: number): HTMLElement {
  const found = screen.getAllByRole('textbox').at(index);
  if (found === undefined) throw new Error(`${index} 番目の入力の欄が無い`);

  return found;
}

function ingredientNameField(): HTMLElement {
  return textboxAt(0);
}

function amountField(): HTMLElement {
  return textboxAt(1);
}

/**
 * 期限の欄。**この suite で唯一もろい引き方である。**
 *
 * `input[type="date"]` は ARIA の役割に写らないため `textbox` で引けず、ラベルの文言は仮である
 * （規則15）。そこで**値が空の入力が1つだけになった状態**で引く — 食材名と分量を先に埋めて
 * おくことが前提である。欄が増えたり順が変わったりすると、この引き方は壊れる。
 */
function expiryDateField(): HTMLElement {
  return screen.getByDisplayValue('');
}

/** 3欄を打つ。期限は最後に引く（`expiryDateField` の前提）。 */
function fillThreeFields(): void {
  fireEvent.change(ingredientNameField(), { target: { value: typedValues.name } });
  fireEvent.change(amountField(), { target: { value: typedValues.amount } });
  fireEvent.change(expiryDateField(), { target: { value: typedValues.expiryDate } });
}

/**
 * 保存の操作を**文書順**で返す（規則8）。
 *
 * 登録の画面の押せる操作は3つで、**先頭が閉じる操作**（規則7）、後ろ2つが保存である。
 * **この数を先に確かめる** — 崩れた回に閉じる操作を保存として押してしまうと、テストは
 * 「送られていない」ではなく別の理由で落ち、何が壊れたか読めなくなる。**名札は見ない**（規則15）。
 */
function saveOperations(): readonly HTMLElement[] {
  const operations = screen.getAllByRole('button');
  expect(operations).toHaveLength(3);

  return operations.slice(1);
}

function saveOperationAt(index: number): HTMLElement {
  const found = saveOperations().at(index);
  if (found === undefined) throw new Error(`${index} 番目の保存の操作が無い`);

  return found;
}

/** 「保存してもう1件」。前に出すほうである（規則8）。 */
function saveAndStay(): HTMLElement {
  return saveOperationAt(0);
}

/** 「保存して閉じる」。文書順の最後である（規則8）。 */
function saveAndClose(): HTMLElement {
  return saveOperationAt(1);
}

/**
 * いま焦点の当たっている要素。
 *
 * **`autoFocus` 属性の有無を見ない**（ADR-052 結果3）— 属性は当て方（実装の手段）であり、
 * 利用者に見えるのは「打ち始めた文字がどの欄に入るか」である。**`textbox` の位置でも引かない** —
 * 欄の並びを変えただけで焦点のテストが赤くなる。
 *
 * **`document` は `globalThis` 越しに読む。** 裸で書くと、`tsc --build` が `dist-test/` へ出した
 * `.js` の側で `no-undef` に当たる（あちらには browser の大域が与えられていない。先行
 * `PantryTab.test.tsx` の `ingredientNameField` が `instanceof` を避けているのと同じ理由）。
 */
function focused(): HTMLElement {
  const element = globalThis.document.activeElement;

  // **どこにも焦点が当たっていないとき、jsdom が返すのは `<body>` である。** そこへ打とうと
  // すると道具の側の例外（値を書ける要素ではない）になり、落ちた理由が読めなくなるので、
  // ここで「焦点の当たった欄が無い」と断つ。
  if (element === null || element === globalThis.document.body) {
    throw new Error('開いた直後に焦点の当たった欄が無い（規則13）');
  }

  return element as HTMLElement;
}

describe('登録の画面 StockItemForm の2つの保存', () => {
  it('「保存してもう1件」を押すと、打った3欄の値が登録の口へ届く', () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }));

    fillThreeFields();
    fireEvent.click(saveAndStay());

    // 規則8・9 / FR-08: 保存は2つあり、**どちらも同じ登録の口を同じ入力で呼ぶ**。
    expect(registrations).toEqual([{ name: 'にんじん', amount: '2本', expiryDate: '2026-09-25' }]);
  });

  it('「保存して閉じる」を押しても、同じ3欄の値が同じ登録の口へ届く', () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }));

    fillThreeFields();
    fireEvent.click(saveAndClose());

    // 規則9: 違うのは**通ったあと**だけである（留まるか一覧へ戻るか）。送る中身は同じ。
    expect(registrations).toEqual([{ name: 'にんじん', amount: '2本', expiryDate: '2026-09-25' }]);
  });

  it('「保存してもう1件」が通ったら、打った値はどの欄にも残らない', async () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }));

    fillThreeFields();
    fireEvent.click(saveAndStay());

    // 結末は非同期に届くので、送られたことを待ってから欄を見る。**待つ手がかりは案内の文言では
    // なくテストが記録した配列である**（先行 `PantryTab.test.tsx`）。
    await waitFor(() => {
      expect(registrations).toHaveLength(1);
    });

    // 規則9 / FR-08 / B-12 設計 規則12: 続けてもう1件入れられる状態に戻す。
    expect(screen.queryByDisplayValue('にんじん')).toBeNull();
    expect(screen.queryByDisplayValue('2本')).toBeNull();
    expect(screen.queryByDisplayValue('2026-09-25')).toBeNull();
  });

  it('「保存してもう1件」が通ったあと、続けて打った2件目も登録の口へ届く', async () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }));

    fillThreeFields();
    fireEvent.click(saveAndStay());

    // 欄が空に戻るのを待つ。ここまで来れば送り終えており、2件目を送れる（規則11）。
    await waitFor(() => {
      expect(screen.queryByDisplayValue('にんじん')).toBeNull();
    });

    fireEvent.change(ingredientNameField(), { target: { value: '白菜' } });
    fireEvent.click(saveAndStay());

    // 規則9 / FR-08: 留まったあとの2件目も同じ口へ届く（1件で終わりにしない）。
    expect(registrations.at(1)?.name).toBe('白菜');
  });

  it('開いた直後に打ち始めた文字は、食材名として登録の口へ届く', () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }));

    fireEvent.change(focused(), { target: { value: 'にんじん' } });
    fireEvent.click(saveAndStay());

    // 規則13 / B-12 設計 規則10b / NFR-15: 開いた直後は食材名の欄に焦点が当たっている。
    // **どの欄かは「打った文字がどこへ届いたか」で観る**（設計 6章末尾の2択の後者）。
    expect(registrations.at(0)?.name).toBe('にんじん');
  });

  it('登録が断られても、打った食材名は欄に残る', async () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(
      recordingRegister(registrations, { outcome: 'rejected', rule: 'expiryDate.format' }),
    );

    fillThreeFields();
    // 通った回に欄を空へ戻すのはこちらの保存である（規則9）。**断られた回に空にしないこと**を
    // 観るので、対にして同じ操作で確かめる。
    fireEvent.click(saveAndStay());

    await waitFor(() => {
      expect(registrations).toHaveLength(1);
    });

    // 規則10 / NFR-15 / 7章 行1: 入力を残す。打ち直しは1件10秒に収まらない。
    expect(screen.queryByDisplayValue('にんじん')).not.toBeNull();
  });

  it('登録が失敗しても、打った食材名は欄に残る', async () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'failed' }));

    fillThreeFields();
    fireEvent.click(saveAndStay());

    await waitFor(() => {
      expect(registrations).toHaveLength(1);
    });

    // 規則10 / NFR-15 / 7章 行2: 失敗も断りと同じ扱いで、入力を消さない。
    expect(screen.queryByDisplayValue('にんじん')).not.toBeNull();
  });

  it('送っている間にもう一方の保存を押しても、登録の口へは1件しか届かない', async () => {
    const registrations: RegisterStockItemInput[] = [];
    const { register, settle } = pendingRegister(registrations);
    renderForm(register);

    fillThreeFields();
    fireEvent.click(saveAndStay());

    // 前提: 1件は送られ、結末はまだ返っていない（保留のまま）。
    expect(registrations).toHaveLength(1);

    fireEvent.click(saveAndClose());

    // 規則11 / B-12 設計 規則8 / ADR-007: 送っている間はどちらも効かない。二重に送ると、
    // 同名でも統合されない在庫品が2件残る。
    expect(registrations).toEqual([{ name: 'にんじん', amount: '2本', expiryDate: '2026-09-25' }]);

    // 保留を解いてから終える — 届いた更新を `act` の中で起こすためである。
    settle();
    await waitFor(() => {
      expect(screen.queryByDisplayValue('にんじん')).toBeNull();
    });
  });

  it('食材名が空のまま「保存して閉じる」を押しても、登録の口へ何も届かない', () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }));

    // 期限の欄を引くには食材名と分量が埋まっている必要があるため（`expiryDateField` の doc）、
    // 3欄を埋めてから**食材名だけを空に戻す**。残るのは分量と期限である。
    fillThreeFields();
    fireEvent.change(ingredientNameField(), { target: { value: '' } });

    fireEvent.click(saveAndClose());

    // 規則11 / B-12 設計 規則2: 食材名から登録の入力が作れないときは、どちらの保存も効かない。
    expect(registrations).toEqual([]);
  });
});
