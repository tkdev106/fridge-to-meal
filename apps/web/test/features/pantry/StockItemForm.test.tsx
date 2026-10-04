// @vitest-environment jsdom
/**
 * 登録の画面 `StockItemForm` の**2つの保存と焦点**（B-39 設計 6章 規則8〜13 / 7章 /
 * ADR-052 / `docs/testing.md` 4.1）。
 *
 * **B-39 が足す振る舞いのぶんだけ**である（設計 2章「作らないもの」）。空欄の読み替えは
 * `StockItemFormValues.test.ts`、断りから案内を選ぶ判断は `RegisterFailureNotice.test.ts`、
 * B-12 が置いた既存の振る舞いの網羅は B-40 の持ち分であり、ここで二重に書かない。
 *
 * **文言は ADR-074 で確定した**（`docs/design/`。B-65）。確定した文言を期待値に書くのは末尾の
 * B-65 の suite だけで、それより前の観点は文言に頼らず、次の3つで観る（B-39 のときの書き方の
 * まま残す — 文言が変わっても振る舞いの観点が赤くならないようにするため）。
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
import { act, fireEvent, render, screen, waitFor } from '../../support/dom/renderComponent.js';
import { FixedBackNavigation } from '../../support/backNavigation/FixedBackNavigation.js';
import { FixedStockItemRequests } from '../../support/server/FixedStockItemRequests.js';
import type { FixedStockItemRequestsOptions } from '../../support/server/FixedStockItemRequests.js';
import { BackNavigationProvider } from '../../../src/backNavigation/BackHandler.js';
import type { IngredientNamesState } from '../../../src/features/pantry/IngredientNameOptions.js';
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

function renderForm(
  onRegister: RegisterStockItem,
  ingredientNames: IngredientNamesState = { outcome: 'loading' },
  offline = false,
) {
  return render(
    <StockItemForm
      onRegister={onRegister}
      onClose={ignoreClose}
      ingredientNames={ingredientNames}
      offline={offline}
    />,
  );
}

/**
 * 欄を役割と文書順で引く。3欄のうち `textbox` になるのは分量だけである — 食材名は補完の
 * 欄として `role="combobox"` を明示しているため役割が `combobox` になり（B-50c / B-66 設計
 * 規則13）、期限は `type="date"` なのでどちらの役割にも入らない。
 *
 * **`instanceof HTMLInputElement` で絞らない** — 役割で引いている以上、入力の欄であることは
 * 問い合わせの側が保証している。**DOM の形を辿らない**（ADR-052 結果3。先行
 * `PantryTab.test.tsx` の `ingredientNameField` と同じ理由）。
 */
function textboxAt(index: number): HTMLElement {
  const found = screen.getAllByRole('textbox').at(index);
  if (found === undefined) throw new Error(`${index} 番目の入力の欄が無い`);

  return found;
}

/**
 * 食材名の欄。**補完が付いた欄は `combobox` である**（B-50c）— `role="combobox"` を明示して
 * いるため（B-66 設計 規則13）、**補完が0件の回も欄はこの役割のままである**（B-66 設計 10章）。
 */
function ingredientNameField(): HTMLElement {
  return screen.getByRole('combobox');
}

function amountField(): HTMLElement {
  return textboxAt(0);
}

/**
 * 期限の欄。**この suite で唯一もろい引き方である。**
 *
 * `input[type="date"]` は ARIA の役割に写らないため `textbox` で引けない。B-39 の観点はラベルの
 * 文言に頼らずに書いたので、**値が空の入力が1つだけになった状態**で引く — 食材名と分量を先に埋めて
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
 * 保存せずに閉じる操作（`戻る` と `閉じる`。規則7 / B-65 規則2 / B-65b 規則9）。名前は原本から
 * 取った文言で仮ではない（ADR-074）。
 */
function closeOperations(): readonly HTMLElement[] {
  return [
    ...screen.queryAllByRole('button', { name: '戻る' }),
    ...screen.queryAllByRole('button', { name: '閉じる' }),
  ];
}

/**
 * 保存の操作を**文書順**で返す（規則8）。
 *
 * 登録の画面の押せる操作は、保存せずに閉じる操作（`closeOperations`）を除けば保存の2つである。
 * **この数を先に確かめる** — 崩れた回に閉じる操作を保存として押してしまうと、テストは
 * 「送られていない」ではなく別の理由で落ち、何が壊れたか読めなくなる。**保存の名札では引かない**
 * （規則15。送っている間は押した側の名札が変わる）。
 */
function saveOperations(): readonly HTMLElement[] {
  const closes = closeOperations();
  const operations = screen.getAllByRole('button').filter((button) => !closes.includes(button));
  expect(operations).toHaveLength(2);

  return operations;
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
 */
function focused(): HTMLElement {
  const element = document.activeElement;

  // **どこにも焦点が当たっていないとき、jsdom が返すのは `<body>` である。** そこへ打とうと
  // すると道具の側の例外（値を書ける要素ではない）になり、落ちた理由が読めなくなるので、
  // ここで「焦点の当たった欄が無い」と断つ。
  if (element === null || element === document.body) {
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
    expect(registrations).toEqual([
      { name: 'にんじん', amount: '2本', expiryDate: '2026-09-25', useForMeals: true },
    ]);
  });

  it('「保存して閉じる」を押しても、同じ3欄の値が同じ登録の口へ届く', () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }));

    fillThreeFields();
    fireEvent.click(saveAndClose());

    // 規則9: 違うのは**通ったあと**だけである（留まるか一覧へ戻るか）。送る中身は同じ。
    expect(registrations).toEqual([
      { name: 'にんじん', amount: '2本', expiryDate: '2026-09-25', useForMeals: true },
    ]);
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
    expect(registrations).toEqual([
      { name: 'にんじん', amount: '2本', expiryDate: '2026-09-25', useForMeals: true },
    ]);

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

/**
 * **B-39 より前からあった振る舞い**（B-40 設計 2章 / 6章 規則1〜14 / 7章）。上の suite とは
 * 1件も重ならない — こちらが観るのは3欄の通り道と、断りの案内の出し方・消え方である。
 *
 * 空欄をどう読み替えるかは `StockItemFormValues.test.ts`、断りから案内を**選ぶ判断**は
 * `RegisterFailureNotice.test.ts` が既に押さえている（設計 規則9）。ここで確かめるのは
 * **切り出せないもの**だけ、すなわち選ばれた案内が画面にどう現れるかである。
 *
 * **案内は文言で観ない**（設計 規則11）。出ていること／消えたことは
 * `queryAllByRole('paragraph')` の**数**で、断りの別は**2回の描画の文字列が一致しないこと**で
 * 観る。**この suite では文面そのものを期待値に書かない** — B-40 のときの書き方のまま残す
 * （文言は ADR-074 で確定した。文面を見るのは末尾の B-65 の suite である）。
 *
 * 差し替えは `FixedStockItemRequests` を使う（設計 5章）。上の suite の局所の口と違い、
 * **結末を順に配れて保留もできる**ため、「断られたあともう一度送る」「次の保存を始める」を
 * 実時間を待たずに書ける（設計 規則7）。
 */

function renderFormWith(options: FixedStockItemRequestsOptions) {
  const requests = new FixedStockItemRequests(options);

  return { requests, rendered: renderForm(requests.registerStockItem) };
}

/** 出ている案内。**数だけを見る**（設計 規則11）。 */
function notices(): readonly HTMLElement[] {
  return screen.queryAllByRole('paragraph');
}

/**
 * 出ている案内の文字列。**期待値に書くためではなく、2回の描画を突き合わせるためだけに読む**
 * （設計 規則11）。同時に出る案内は1つまでである。
 */
function soleNoticeText(): string {
  const [notice, ...rest] = notices();
  if (notice === undefined || rest.length > 0) {
    throw new Error('案内が1つだけ出ている状態ではない');
  }

  return notice.textContent ?? '';
}

/** 案内が届くまで待つ。**待つ条件に文言を使わない**（設計 規則7・11）。 */
async function waitForSoleNotice(): Promise<string> {
  await waitFor(() => {
    expect(notices()).toHaveLength(1);
  });

  return soleNoticeText();
}

describe('登録の画面 StockItemForm の3欄と案内', () => {
  it('分量と期限を打たずに保存すると、どちらも未設定として登録の口へ届く', () => {
    const { requests } = renderFormWith({ register: [{ outcome: 'registered' }] });

    fireEvent.change(ingredientNameField(), { target: { value: 'にんじん' } });
    fireEvent.click(saveAndStay());

    // FR-13 / FR-01 / B-12 設計 規則3: 任意の2欄は空のまま保存でき、**空文字ではなく未設定**
    // として届く（contract は省略と `null` を同義と定めている）。
    expect(requests.registeredInputs).toEqual([
      { name: 'にんじん', amount: null, expiryDate: null, useForMeals: true },
    ]);
  });

  it('登録が断られると案内が1つ出る', async () => {
    const { requests } = renderFormWith({
      register: [{ outcome: 'rejected', rule: 'expiryDate.format' }],
    });

    fillThreeFields();

    // 押す前には案内が出ていない（出ていたら「断りで出た」と読めない）。
    expect(notices()).toHaveLength(0);

    fireEvent.click(saveAndStay());

    // ADR-032 決定3 / B-24: 断りは案内1つで伝える。**文面は見ない**（文面は B-65 の suite が見る）。
    await waitForSoleNotice();
    expect(requests.registeredInputs).toHaveLength(1);
  });

  it('断りの理由が違えば、出る案内も違う', async () => {
    const nameEmpty = renderFormWith({
      register: [{ outcome: 'rejected', rule: 'name.empty' }],
    });

    fillThreeFields();
    fireEvent.click(saveAndStay());
    const nameEmptyNotice = await waitForSoleNotice();
    nameEmpty.rendered.unmount();

    renderFormWith({ register: [{ outcome: 'rejected', rule: 'expiryDate.format' }] });

    fillThreeFields();
    fireEvent.click(saveAndStay());
    const expiryDateNotice = await waitForSoleNotice();

    // ADR-032 決定3 / 設計 規則11: **どこを直せばよいかが読めること**を、2回の描画の文字列が
    // 一致しないことで観る。**文面そのものは期待値に書かない。**
    expect(expiryDateNotice).not.toBe(nameEmptyNotice);
  });

  it('登録が通った回は案内を出さない', async () => {
    const { requests } = renderFormWith({ register: [{ outcome: 'registered' }] });

    fillThreeFields();
    fireEvent.click(saveAndStay());

    // 結末が届いたことは**テストが打った値の記録**で待つ（設計 規則7）。
    await waitFor(() => {
      expect(requests.registeredInputs).toHaveLength(1);
    });

    // ADR-032 決定3: 通った回に案内は要らない（`registerFailureNoticeOf` が `null` を返す）。
    expect(notices()).toHaveLength(0);
  });

  it('次の保存を始めると、前に出ていた案内が消える', async () => {
    const { requests } = renderFormWith({
      register: [
        { outcome: 'rejected', rule: 'expiryDate.format' },
        { heldUntilSettled: { outcome: 'registered' } },
      ],
    });

    fillThreeFields();
    fireEvent.click(saveAndStay());
    await waitForSoleNotice();

    fireEvent.click(saveAndStay());

    // 設計 規則11 / B-12 設計 規則8: 新しい保存を始めたら前の案内を消す。**同時に出る案内は
    // 1つまでである**ため、古い断りが残っていると、いまの結末がどれか読めなくなる。
    expect(notices()).toHaveLength(0);

    // 保留を解いてから終える — 届いた更新を `act` の中で起こすためである。
    requests.settle();
    await waitFor(() => {
      expect(screen.queryByDisplayValue('にんじん')).toBeNull();
    });
  });

  it('断られたあと、もう一度保存を押すと2件目が登録の口へ届く', async () => {
    const { requests } = renderFormWith({
      register: [{ outcome: 'rejected', rule: 'expiryDate.format' }, { outcome: 'registered' }],
    });

    fillThreeFields();
    fireEvent.click(saveAndStay());
    await waitForSoleNotice();

    fireEvent.click(saveAndStay());

    // ADR-007 / NFR-07 の構え / NFR-15: 自動で送り直さない代わりに、**入力を残したまま
    // 利用者の操作でいつでも送り直せる。**
    await waitFor(() => {
      expect(requests.registeredInputs).toHaveLength(2);
    });
  });
});

/**
 * 欄の直下の一覧に出ている名称を引く（B-66 設計 6章 規則13）。行は `option` の役割で引き、
 * 名称は行の文字で読む — DOM の形は辿らない。**行が無ければ引く側が例外で落ちる**ので、
 * 一覧が出ないことは `completionListbox()` が `null` であることで見る。
 */
function completionOptions(): readonly string[] {
  return screen.getAllByRole('option').map((option) => option.textContent ?? '');
}

/** 一覧が木に無いこと。**隠しているだけでも見つける**ために `hidden: true` で引く。 */
function completionListbox(): HTMLElement | null {
  return screen.queryByRole('listbox', { hidden: true });
}

describe('登録の画面 StockItemForm の食材名の補完', () => {
  it('取れた名称のうち打った文字に合うものが、食材名の欄の一覧に出る', () => {
    // FR-02 / B-66 設計 規則1・4: その世帯の在庫品と献立の材料から集めた名称のうち、
    // 打ちかけの文字を含むものを欄の直下に出す（ADR-063）。
    renderForm(recordingRegister([], { outcome: 'registered' }), {
      outcome: 'loaded',
      ingredientNames: ['にんじん', '豚こま肉'],
    });

    fireEvent.change(ingredientNameField(), { target: { value: 'こま' } });

    expect(completionOptions()).toEqual(['豚こま肉']);
  });

  it('名称の並びを変えない', () => {
    // 並び（コード単位の昇順）を決めるのはサーバである（ADR-063 決定4 / B-66 設計 規則3）。
    renderForm(recordingRegister([], { outcome: 'registered' }), {
      outcome: 'loaded',
      ingredientNames: ['豚こま肉', '牛こま肉'],
    });

    fireEvent.change(ingredientNameField(), { target: { value: 'こま' } });

    expect(completionOptions()).toEqual(['豚こま肉', '牛こま肉']);
  });

  it('名称が取れなかった回は、打っても一覧が出ない', () => {
    // FR-03 / B-66 設計 規則12 / 7章: 取れなかった回は空の列であり、一覧が出ないだけである。
    renderForm(recordingRegister([], { outcome: 'registered' }), { outcome: 'failed' });

    fireEvent.change(ingredientNameField(), { target: { value: 'に' } });

    expect(completionListbox()).toBeNull();
  });

  it('名称が取れなかった回も、打った名前をそのまま登録できる', () => {
    // FR-03 / 設計 規則4: 補完は入力を助けるだけで、登録を止めない。
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }), { outcome: 'failed' });

    fireEvent.change(ingredientNameField(), { target: { value: 'ゴーヤ' } });
    fireEvent.click(saveAndStay());

    expect(registrations).toEqual([
      { name: 'ゴーヤ', amount: null, expiryDate: null, useForMeals: true },
    ]);
  });

  it('補完に無い名前もそのまま登録できる', () => {
    // FR-03: 補完から選ばずに打った名前も、絞り込まれず届く。
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }), {
      outcome: 'loaded',
      ingredientNames: ['にんじん'],
    });

    fireEvent.change(ingredientNameField(), { target: { value: 'ゴーヤ' } });
    fireEvent.click(saveAndStay());

    expect(registrations).toEqual([
      { name: 'ゴーヤ', amount: null, expiryDate: null, useForMeals: true },
    ]);
  });

  it('一覧が出ている間に選ばずに保存しても、打った名前がそのまま届く', () => {
    // FR-03 / B-66 設計 規則11: 部品が値を書き換えるのは選んだときだけである。
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }), {
      outcome: 'loaded',
      ingredientNames: ['にんじん'],
    });

    fireEvent.change(ingredientNameField(), { target: { value: 'にん' } });
    fireEvent.click(saveAndStay());

    expect(registrations).toEqual([
      { name: 'にん', amount: null, expiryDate: null, useForMeals: true },
    ]);
  });

  it('一覧から選んだ名称が登録の口へ届く', () => {
    // FR-02 / B-66 設計 規則7: 選んだ名称がそのまま欄に入り、保存で届く。
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }), {
      outcome: 'loaded',
      ingredientNames: ['豚こま肉'],
    });

    fireEvent.change(ingredientNameField(), { target: { value: 'こま' } });
    fireEvent.keyDown(ingredientNameField(), { key: 'ArrowDown' });
    fireEvent.keyDown(ingredientNameField(), { key: 'Enter' });
    fireEvent.click(saveAndStay());

    expect(registrations).toEqual([
      { name: '豚こま肉', amount: null, expiryDate: null, useForMeals: true },
    ]);
  });

  it('接続が切れていても、打てば一覧が出る', () => {
    // B-66 設計 規則15 / B-70: 止めるのは書き込みだけで、補完は書き込みではない。
    renderForm(
      recordingRegister([], { outcome: 'registered' }),
      { outcome: 'loaded', ingredientNames: ['豚こま肉'] },
      true,
    );

    fireEvent.change(ingredientNameField(), { target: { value: 'こま' } });

    expect(completionOptions()).toEqual(['豚こま肉']);
  });
});

/**
 * 接続が切れている間（B-70 設計 6章 規則6・9・14 / 7章 行1 / FR-41 / NFR-15）。
 *
 * **止めるのは保存の2つと、欄での Enter（`<form>` の送信）である。** 打った値は消さず、
 * 接続が戻れば同じ欄の値で保存できる。「戻る」は止めない（規則6）。
 */
describe('登録の画面 StockItemForm の接続が切れている間', () => {
  /** `offline` を後から切り替えるために、描き直しの口を返す。 */
  function renderFormWith(
    onRegister: RegisterStockItem,
    offline: boolean,
    onClose: () => void = ignoreClose,
  ) {
    const rendered = render(
      <StockItemForm
        onRegister={onRegister}
        onClose={onClose}
        ingredientNames={{ outcome: 'loading' }}
        offline={offline}
      />,
    );

    return {
      setOffline: (next: boolean) => {
        rendered.rerender(
          <StockItemForm
            onRegister={onRegister}
            onClose={onClose}
            ingredientNames={{ outcome: 'loading' }}
            offline={next}
          />,
        );
      },
    };
  }

  it('接続が切れている間は、「保存してもう1件」が押せない', () => {
    renderFormWith(recordingRegister([], { outcome: 'registered' }), true);

    fireEvent.change(ingredientNameField(), { target: { value: 'にんじん' } });

    // 規則9 / FR-41: 登録は書き込みを伴う操作である。素の `disabled` プロパティで見る。
    expect((saveAndStay() as HTMLButtonElement).disabled).toBe(true);
  });

  it('接続が切れている間は、「保存して閉じる」が押せない', () => {
    renderFormWith(recordingRegister([], { outcome: 'registered' }), true);

    fireEvent.change(ingredientNameField(), { target: { value: 'にんじん' } });

    // 規則9 / FR-41。
    expect((saveAndClose() as HTMLButtonElement).disabled).toBe(true);
  });

  it('接続が切れている間は、欄で Enter しても登録の口へ何も届かない', () => {
    const registrations: RegisterStockItemInput[] = [];
    renderFormWith(recordingRegister(registrations, { outcome: 'registered' }), true);

    fireEvent.change(ingredientNameField(), { target: { value: 'にんじん' } });
    fireEvent.submit(ingredientNameField());

    // 規則9 / 7章 行1: 保存の本体で止める（ボタンを押さない経路も塞ぐ）。
    expect(registrations).toEqual([]);
  });

  it('接続が切れている間に打った値は、接続が戻ってから保存すると登録の口へ届く', () => {
    const registrations: RegisterStockItemInput[] = [];
    const { setOffline } = renderFormWith(
      recordingRegister(registrations, { outcome: 'registered' }),
      true,
    );

    fillThreeFields();
    setOffline(false);
    fireEvent.click(saveAndStay());

    // 規則9（入力は消さない）・規則14（戻れば押せるようになる）。
    expect(registrations).toEqual([
      { name: 'にんじん', amount: '2本', expiryDate: '2026-09-25', useForMeals: true },
    ]);
  });

  it('接続が切れていても、「戻る」で一覧へ戻せる', () => {
    const closed: string[] = [];
    const registrations: RegisterStockItemInput[] = [];
    renderFormWith(recordingRegister(registrations, { outcome: 'registered' }), true, () =>
      closed.push('close'),
    );

    const [closeOperation] = screen.getAllByRole('button');
    fireEvent.click(closeOperation as HTMLElement);

    // 規則6: 保存せずに閉じるのは遷移である。登録の口へは何も届かない。
    expect(closed).toHaveLength(1);
    expect(registrations).toEqual([]);
  });
});

/**
 * 見た目と文言（B-65 設計 6章 規則2・3・5・6・8・10・13 / ADR-074 / FR-13 / NFR-16）。
 *
 * **文言は ADR-074 で確定した**（`docs/design/` の原本 ★10）ので、ここでは文言を期待値に
 * literal で書く。CSS の値は見ない（ADR-055 決定3）。並びは**文書順**で観る（先行
 * `MealDetail.test.tsx` の `precedes`）。
 *
 * 欄は**名前で引く**。期限の欄は役割に写らない（`type="date"`）ので `getByLabelText` で引き、
 * 欄の名前の後ろに箱の文字（`日付を選ぶ` / 日付）が続いて読まれてよい（規則6）ため、頭だけを当てる。
 */

/** `node` が `other` より前に在るか（文書の並びで。先行 `MealDetail.test.tsx`）。 */
function precedes(node: Node, other: Node): boolean {
  return (node.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** 食材名の欄。名前は `食材名`（札 `任意` は付かない。規則3）。 */
function namedIngredientNameField(): HTMLElement {
  return screen.getByRole('combobox', { name: '食材名' });
}

/** 分量の欄。名前は `分量` と札 `任意`（規則3）。 */
function namedAmountField(): HTMLElement {
  return screen.getByRole('textbox', { name: /^分量\s*任意$/ });
}

/** 期限の欄。名前の頭が `期限` と札 `任意`（規則3・6）。 */
function namedExpiryDateField(): HTMLInputElement {
  return screen.getByLabelText(/^期限\s*任意/) as HTMLInputElement;
}

/** 残日数の文字（規則8。一覧と同じ語）。 */
const remainingDaysText = /^(今日|あと\d+日|\d+日過ぎ)$/;

/**
 * 日付の選択を開く口を**投げる関数に差し替えて**から `run` を走らせ、終わったら戻す（規則6）。
 * jsdom 30 には `showPicker` が無い。投げる環境でも素の振る舞いに任せることを観るために置く。
 */
function withThrowingShowPicker(run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'showPicker');
  Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
    configurable: true,
    writable: true,
    value: () => {
      throw new DOMException('showPicker は使えない', 'NotAllowedError');
    },
  });

  try {
    run();
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
    } else {
      Object.defineProperty(HTMLInputElement.prototype, 'showPicker', original);
    }
  }
}

/** 3欄を名前で引いて打ち、期限の欄は押してから選ぶ（規則6。押すと日付の選択が開く）。 */
function fillThreeNamedFieldsByPicking(): void {
  fireEvent.change(namedIngredientNameField(), { target: { value: typedValues.name } });
  fireEvent.change(namedAmountField(), { target: { value: typedValues.amount } });
  fireEvent.click(namedExpiryDateField());
  fireEvent.change(namedExpiryDateField(), { target: { value: typedValues.expiryDate } });
}

describe('登録の画面 StockItemForm の見た目と文言', () => {
  it('見出しは「食材を登録」の h1 が1つだけである', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-65 規則2 / ADR-074。
    expect(
      screen.getAllByRole('heading').map((heading) => [heading.tagName, heading.textContent]),
    ).toEqual([['H1', '食材を登録']]);
  });

  it('「戻る」という名前の操作を押すと、一覧へ戻す口が呼ばれる', () => {
    const closed: string[] = [];
    render(
      <StockItemForm
        onRegister={recordingRegister([], { outcome: 'registered' })}
        onClose={() => closed.push('close')}
        ingredientNames={{ outcome: 'loading' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '戻る' }));

    // B-65 規則2: 戻るはアイコンだけで、名前は `aria-label="戻る"` で読ませる。
    expect(closed).toEqual(['close']);
  });

  it('「戻る」の操作は見える文字を持たない', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-65 規則2 / ADR-074: `back` のアイコンだけを置く（先行 `MealDetail` の `.back`）。
    expect(screen.getByRole('button', { name: '戻る' }).textContent).toBe('');
  });

  it('食材名の欄の名前は「食材名」である', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-65 規則3: 食材名には札 `任意` を付けない（必須の欄である）。
    expect(namedIngredientNameField()).not.toBeNull();
  });

  it('分量の欄の名前は「分量」と札「任意」である', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-65 規則3 / FR-13: 任意であることを札の文字で伝える。
    expect(namedAmountField()).not.toBeNull();
  });

  it('期限の欄は名前が「期限」と札「任意」で引ける', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-65 規則3 / FR-13。
    expect(namedExpiryDateField()).not.toBeNull();
  });

  it('期限の欄は日付の欄である', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-65 規則6: 素の `<input type="date">` を残し、見える箱の上に重ねる。
    expect(namedExpiryDateField().type).toBe('date');
  });

  it('置き文字「例: 300g」は分量の欄に出る', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-65 規則5 / ADR-010: 置き文字は分量の欄の `placeholder` である。
    expect(screen.getByPlaceholderText('例: 300g')).toBe(namedAmountField());
  });

  it('開いた直後は期限の箱に「日付を選ぶ」が出る', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-65 規則6 / ADR-074: 期限が空のときの箱の文字。
    expect(screen.queryByText('日付を選ぶ')).not.toBeNull();
  });

  it('期限を選ぶと、期限の箱に「M月D日（曜）」が出る', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    fireEvent.change(namedExpiryDateField(), { target: { value: '2026-10-03' } });

    // B-65 規則6・7 / ADR-074。
    expect(screen.queryByText('10月3日（土）')).not.toBeNull();
  });

  it('期限を選ぶと、「日付を選ぶ」は消える', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    fireEvent.change(namedExpiryDateField(), { target: { value: '2026-10-03' } });

    // B-65 規則6: 箱の文字は値から作る。値があれば空のときの文字を出さない。
    expect(screen.queryByText('日付を選ぶ')).toBeNull();
  });

  it('登録の画面では、期限を選んでも残日数を出さない', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    fireEvent.change(namedExpiryDateField(), { target: { value: '2026-10-03' } });

    // B-65 規則8 / 設計 10章: 残日数は編集の画面だけに出す（登録は基準日を受け取らない）。
    expect(screen.queryByText(remainingDaysText)).toBeNull();
  });

  it('日付の選択を開く口が無くても、期限の欄で選んだ日付が登録の口へ届く', () => {
    // 前提: jsdom 30 には `showPicker` が無い（無い環境を作るために差し替えない）。
    expect('showPicker' in HTMLInputElement.prototype).toBe(false);
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }));

    fillThreeNamedFieldsByPicking();
    fireEvent.click(saveAndStay());

    // B-65 規則6・13: 無い環境では素の振る舞いに任せ、送る中身は変えない。
    expect(registrations).toEqual([
      { name: 'にんじん', amount: '2本', expiryDate: '2026-09-25', useForMeals: true },
    ]);
  });

  it('日付の選択を開く口が投げても、期限の欄で選んだ日付が登録の口へ届く', () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }));

    withThrowingShowPicker(() => {
      fillThreeNamedFieldsByPicking();
      fireEvent.click(saveAndStay());
    });

    // B-65 規則6・13: 投げる環境でも例外を外へ出さず、送る中身は変えない。
    expect(registrations).toEqual([
      { name: 'にんじん', amount: '2本', expiryDate: '2026-09-25', useForMeals: true },
    ]);
  });

  it('食材名が空という断りは「! 食材名を入れてください」の段落1つで出る', async () => {
    renderFormWith({ register: [{ outcome: 'rejected', rule: 'name.empty' }] });

    fireEvent.change(namedIngredientNameField(), { target: { value: 'にんじん' } });
    fireEvent.click(saveAndStay());

    // B-65 規則10 / ADR-074: 頭に `!` を付け、文末の句点は付けない。同時に出る断りは1つ。
    expect(await waitForSoleNotice()).toMatch(/^!\s*食材名を入れてください$/);
  });

  it('食材名が空という断りは、食材名の欄と分量の欄の間に出る', async () => {
    renderFormWith({ register: [{ outcome: 'rejected', rule: 'name.empty' }] });

    fireEvent.change(namedIngredientNameField(), { target: { value: 'にんじん' } });
    fireEvent.click(saveAndStay());
    await waitForSoleNotice();
    const [notice] = notices();

    // B-65 規則10: 食材名の欄の直下に出す（どこを直すかが位置で読める）。
    expect([
      precedes(namedIngredientNameField(), notice as HTMLElement),
      precedes(notice as HTMLElement, namedAmountField()),
    ]).toEqual([true, true]);
  });

  it('期限の書式の断りは、期限の欄と「保存してもう1件」の間に出る', async () => {
    renderFormWith({ register: [{ outcome: 'rejected', rule: 'expiryDate.format' }] });

    fireEvent.change(namedIngredientNameField(), { target: { value: 'にんじん' } });
    fireEvent.click(saveAndStay());
    await waitForSoleNotice();
    const [notice] = notices();

    // B-65 規則10: ほかの断りの位置は今のまま（欄群の後、保存の操作の前）。
    expect([
      precedes(namedExpiryDateField(), notice as HTMLElement),
      precedes(notice as HTMLElement, screen.getByRole('button', { name: '保存してもう1件' })),
    ]).toEqual([true, true]);
  });
});

/**
 * 見出しの行の `閉じる`（B-65b 設計 6章 規則9 / ADR-074 / ADR-076 決定2）。
 *
 * SP は `戻る`（アイコン）、PC は `閉じる`（見える文字）を CSS で出し分けるが、**木には2つとも
 * 置く**（10章 前提3 — 幅で ARIA を変えられない）。jsdom ではどちらも見えるので、名前で引き分ける。
 * 見た目（下線・幅で隠すこと）は CSS で、ここでは見ない（ADR-055 決定3）。
 */
describe('登録の画面 StockItemForm の `閉じる`', () => {
  /** 一覧へ戻す口を配列に残して描く。 */
  function renderFormRecordingClose(
    onRegister: RegisterStockItem,
    closed: string[],
    offline = false,
  ) {
    return render(
      <StockItemForm
        onRegister={onRegister}
        onClose={() => closed.push('close')}
        ingredientNames={{ outcome: 'loading' }}
        offline={offline}
      />,
    );
  }

  function closeButton(): HTMLElement {
    return screen.getByRole('button', { name: '閉じる' });
  }

  it('見出しの行は文書順で `戻る`・見出し・`閉じる` と並ぶ', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-65b 規則9 / 原本 `IngredientForm`（SP は左に戻る、PC は右に閉じる）。
    const back = screen.getByRole('button', { name: '戻る' });
    const heading = screen.getByRole('heading', { level: 1, name: '食材を登録' });
    expect([precedes(back, heading), precedes(heading, closeButton())]).toEqual([true, true]);
  });

  it('`閉じる` は見える文字 `閉じる` を持つ', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-65b 規則9 / ADR-074: アイコンではなく文字の button である。
    expect(closeButton().textContent).toBe('閉じる');
  });

  it('`閉じる` を押すと、一覧へ戻す口が呼ばれる', () => {
    const closed: string[] = [];
    renderFormRecordingClose(recordingRegister([], { outcome: 'registered' }), closed);

    fireEvent.click(closeButton());

    // B-65b 規則9: `戻る` と同じ「保存せずに閉じる」である。
    expect(closed).toEqual(['close']);
  });

  it('食材名を打ってから `閉じる` を押しても、登録の口へは何も届かない', () => {
    const registrations: RegisterStockItemInput[] = [];
    renderFormRecordingClose(recordingRegister(registrations, { outcome: 'registered' }), []);

    fireEvent.change(ingredientNameField(), { target: { value: typedValues.name } });
    fireEvent.click(closeButton());

    // B-65b 規則9 / B-39 規則7: 閉じるのは捨てることである（`<form>` の送信にならない）。
    expect(registrations).toEqual([]);
  });

  it('送っている間は `閉じる` を押しても一覧へ戻す口が呼ばれない', async () => {
    const closed: string[] = [];
    const registrations: RegisterStockItemInput[] = [];
    const { register, settle } = pendingRegister(registrations);
    renderFormRecordingClose(register, closed);

    fillThreeFields();
    fireEvent.click(screen.getByRole('button', { name: '保存してもう1件' }));
    // 前提: 1件は送られ、結末はまだ返っていない（保留のまま）。
    expect(registrations).toHaveLength(1);

    fireEvent.click(closeButton());

    // B-65b 規則9 / B-39 規則11: 送っている間はどちらの閉じる操作も効かない。
    expect(closed).toEqual([]);

    // 保留を解いてから終える — 届いた更新を `act` の中で起こすためである。
    settle();
    await waitFor(() => {
      expect(screen.queryByDisplayValue('にんじん')).toBeNull();
    });
  });

  it('接続が切れていても `閉じる` で一覧へ戻せる', () => {
    const closed: string[] = [];
    const registrations: RegisterStockItemInput[] = [];
    renderFormRecordingClose(
      recordingRegister(registrations, { outcome: 'registered' }),
      closed,
      true,
    );

    fireEvent.click(closeButton());

    // B-70 / B-65 規則6: 保存せずに閉じるのは遷移で、止めない。登録の口へは何も届かない。
    expect([closed, registrations]).toEqual([['close'], []]);
  });
});

/**
 * 端末の「戻る」（B-75 設計 6章 規則1・2・6 / ADR-084）。
 *
 * 継ぎ目は記憶上の `FixedBackNavigation` に差し替え、`pressBack()` で「利用者が戻るを押した」
 * ことにする。**届いた先は一覧へ戻す口を配列に残して観る**（`docs/testing.md` 2章）。
 */
describe('登録の画面 StockItemForm の端末の戻る', () => {
  function renderFormWithBack(onRegister: RegisterStockItem, closed: string[]) {
    const backNavigation = new FixedBackNavigation();
    render(
      <BackNavigationProvider backNavigation={backNavigation}>
        <StockItemForm
          onRegister={onRegister}
          onClose={() => closed.push('close')}
          ingredientNames={{ outcome: 'loading' }}
          offline={false}
        />
      </BackNavigationProvider>,
    );

    return backNavigation;
  }

  function pressBack(backNavigation: FixedBackNavigation): void {
    act(() => {
      backNavigation.pressBack();
    });
  }

  it('登録の画面で戻ると、一覧へ戻す口へ届く', () => {
    const closed: string[] = [];
    const backNavigation = renderFormWithBack(
      recordingRegister([], { outcome: 'registered' }),
      closed,
    );

    pressBack(backNavigation);

    // 規則1・2: 「戻る」の操作と同じ口で閉じる（パネル → 一覧）。
    expect(closed).toEqual(['close']);
  });

  it('登録を送っている間に戻っても、一覧へ戻す口は呼ばれない', async () => {
    const closed: string[] = [];
    const registrations: RegisterStockItemInput[] = [];
    const { register, settle } = pendingRegister(registrations);
    const backNavigation = renderFormWithBack(register, closed);
    fillThreeFields();
    fireEvent.click(saveAndStay());
    // 前提: 1件は送られ、結末はまだ返っていない（保留のまま）。
    expect(registrations).toHaveLength(1);

    pressBack(backNavigation);

    // 規則6 / B-39 規則11: 送っている間は戻るを飲み込む。閉じると断りの案内が出ないまま
    // 入力が捨てられる。
    expect(closed).toEqual([]);

    settle();
    await waitFor(() => {
      expect(screen.queryByDisplayValue('にんじん')).toBeNull();
    });
  });

  it('飲み込まれた戻るのあと、送り終えてから戻ると一覧へ戻す口へ届く', async () => {
    const closed: string[] = [];
    const registrations: RegisterStockItemInput[] = [];
    const { register, settle } = pendingRegister(registrations);
    const backNavigation = renderFormWithBack(register, closed);
    fillThreeFields();
    fireEvent.click(saveAndStay());
    pressBack(backNavigation);
    settle();
    await waitFor(() => {
      expect(screen.queryByDisplayValue('にんじん')).toBeNull();
    });

    pressBack(backNavigation);

    // 規則6・8: 飲み込んだ回も口は登録したまま残り、次の戻るで閉じる。
    expect(closed).toEqual(['close']);
  });
});

/**
 * 「献立に使う」のチェックボックス（B-76 設計 6章 規則13・15・16 / FR-01 / FR-08）。
 *
 * 文言は確定している（ADR-074）ので名前で引く。並びは**文書順**で観る（`precedes`）。
 * 送った値は登録の口へ届いた入力の配列で観る（`docs/testing.md` 2章）。
 */
describe('登録の画面 StockItemForm の献立に使う', () => {
  function useForMealsCheckbox(): HTMLInputElement {
    return screen.getByRole('checkbox', { name: '献立に使う' }) as HTMLInputElement;
  }

  it('開いた直後は「献立に使う」のチェックが入っている', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-76 規則13: 開いた直後はオン。
    expect(useForMealsCheckbox().checked).toBe(true);
  });

  it('「献立に使う」は期限の欄の後、「保存してもう1件」の前に並ぶ', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-76 規則13: 欄の最後（期限の後、保存の操作の前）。
    expect([
      precedes(namedExpiryDateField(), useForMealsCheckbox()),
      precedes(useForMealsCheckbox(), screen.getByRole('button', { name: '保存してもう1件' })),
    ]).toEqual([true, true]);
  });

  it('何も触らずに保存すると、献立に使うとして登録の口へ届く', () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }));

    fireEvent.change(namedIngredientNameField(), { target: { value: 'にんじん' } });
    fireEvent.click(saveAndStay());

    // B-76 規則13・15: 既定のオンが真偽値で届く（省略しない）。
    expect(registrations).toEqual([
      { name: 'にんじん', amount: null, expiryDate: null, useForMeals: true },
    ]);
  });

  it('チェックを外して保存すると、献立に使わないとして登録の口へ届く', () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }));

    fireEvent.change(namedIngredientNameField(), { target: { value: 'にんじん' } });
    fireEvent.click(useForMealsCheckbox());
    fireEvent.click(saveAndStay());

    // B-76 規則15 / FR-01。
    expect(registrations).toEqual([
      { name: 'にんじん', amount: null, expiryDate: null, useForMeals: false },
    ]);
  });

  it('チェックを外して「保存してもう1件」が通ったあと、チェックはまた入っている', async () => {
    const registrations: RegisterStockItemInput[] = [];
    renderForm(recordingRegister(registrations, { outcome: 'registered' }));

    fireEvent.change(namedIngredientNameField(), { target: { value: 'にんじん' } });
    fireEvent.click(useForMealsCheckbox());
    fireEvent.click(saveAndStay());

    // 結末が届いて欄が空へ戻るのを待つ（打った値の記録で待つ。B-40 設計 規則7）。
    await waitFor(() => {
      expect(screen.queryByDisplayValue('にんじん')).toBeNull();
    });

    // B-76 規則13 / FR-08: 「保存してもう1件」が通った直後もオンに戻す。
    expect(useForMealsCheckbox().checked).toBe(true);
  });

  it('「献立に使う」の名前に札「任意」は付かない', () => {
    renderForm(recordingRegister([], { outcome: 'registered' }));

    // B-76 規則16: 名前の頭が「献立に使う」のチェックボックスは、名前がちょうど「献立に使う」
    // のものと同じである（後ろに札が続いていない）。
    expect(screen.getByRole('checkbox', { name: /^献立に使う/ })).toBe(
      screen.queryByRole('checkbox', { name: '献立に使う' }),
    );
  });
});
