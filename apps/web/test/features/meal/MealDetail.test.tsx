// @vitest-environment jsdom
/**
 * 献立詳細の**表示の分岐**（B-53 / `docs/screen-design.md` 4章 / ADR-052）。
 *
 * 材料の並びと印の判断は `MealDetailIngredients.ts` の純粋関数のテストが既に押さえている。
 * ここで確かめるのは**受け取った結末のどれを描くか**と、**取れた献立に何が載るか**だけである。
 *
 * **仮の文言を期待値に書かない**（ADR-052 結果2 / 同書 論点3）。観察は次の3つで行う。
 *
 * - **役割** … 材料の印は `note`、案内は `status`、注意表示は `complementary`
 * - **こちらが渡したデータ** … 献立の名称・材料の名称と分量・手順の文
 * - **件数** … 印がいくつ出るか、注意表示がいくつ出るか
 *
 * **記録済みの表示（B-53b）も文言を留めない。** `cooked` / `recorded` だけが違う2つの描画の
 * 本文を比べ、**増えた文字**を記録済みの表示として観る（`cookedIndicator`）。
 */

import { describe, expect, it } from 'vitest';
import type { MealIngredientDto, ShowMealOutput } from '@fridge-to-meal/contract';
import { fireEvent, render, screen, within } from '../../support/dom/renderComponent.js';
import { MealDetail } from '../../../src/features/meal/MealDetail.js';
import type { MealDetailProps } from '../../../src/features/meal/MealDetail.js';

function main(name: string, amount: string | null = null): MealIngredientDto {
  return { name, kind: 'main', amount };
}

function seasoning(name: string, amount: string | null = null): MealIngredientDto {
  return { name, kind: 'seasoning', amount };
}

function meal(overrides: Partial<ShowMealOutput> = {}): ShowMealOutput {
  return {
    mealId: 'meal-1',
    title: '豚こま肉と白菜の生姜焼き',
    ingredients: [main('豚こま肉', '300g')],
    steps: ['白菜を一口大に切る'],
    coverage: {
      covered: [{ ...main('豚こま肉', '300g'), expiryDate: '2026-09-20' }],
      missing: [],
    },
    cooked: false,
    ...overrides,
  };
}

type RenderOverrides = Partial<Omit<MealDetailProps, 'meal'>>;

/** 記録まわりの4つの props は既定値を持たせ、表示の分岐だけを見る観点を軽くする。 */
function renderDetail(state: MealDetailProps['meal'], overrides: RenderOverrides = {}) {
  return render(
    <MealDetail
      meal={state}
      onClose={overrides.onClose ?? (() => {})}
      onAddCookingRecord={overrides.onAddCookingRecord ?? (() => {})}
      recording={overrides.recording ?? false}
      recordFailureNotice={overrides.recordFailureNotice ?? null}
      recorded={overrides.recorded ?? false}
    />,
  );
}

/** 記録の操作。**取れた献立の枝にだけ在る**（規則9）ので、無ければ `null` が返る。 */
function cookedControl(): HTMLElement | null {
  const buttons = screen.queryAllByRole('button');

  // 「←」は最初に置かれる（画面設計 4章のワイヤー）。記録の操作はそれ以外の1つである。
  return buttons[1] ?? null;
}

/** 閉じる操作（「←」）。 */
function closeControl(): HTMLElement | null {
  return screen.queryAllByRole('button')[0] ?? null;
}

/** 描いた本文（`textContent`）を読み、描いたものを片付けて返す。 */
function bodyTextOf(state: MealDetailProps['meal'], overrides: RenderOverrides = {}): string {
  const { container, unmount } = renderDetail(state, overrides);
  const text = container.textContent ?? '';

  unmount();

  return text;
}

/**
 * 2つの本文のうち、`after` にだけ増えた文字。共通の先頭と共通の末尾を落とした残りである
 * （表示が1か所に差し込まれることを前提にする）。
 */
function addedTextOf(before: string, after: string): string {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) {
    head += 1;
  }

  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }

  return after.slice(head, after.length - tail);
}

/**
 * 記録済みの表示の文字。**仮の文言を期待値に書かない**（論点3）ので、`cooked` だけが違う
 * 2つの描画を比べて増えた文字を取り出す（B-53b 規則8）。**何も増えなければここで落ちる** —
 * 空文字のまま先へ進むと、`toContain('')` が常に通って観察が意味を失う。
 */
function cookedIndicator(): string {
  const withoutRecord = bodyTextOf({ outcome: 'shown', meal: meal({ cooked: false }) });
  const withRecord = bodyTextOf({ outcome: 'shown', meal: meal({ cooked: true }) });

  const added = addedTextOf(withoutRecord, withRecord);
  expect(added, '記録のある献立の描画に、増えた文字が無い').not.toBe('');

  return added;
}

/** 読み上げに渡る文字（漢字・ひらがな・カタカナのどれか）。**文言そのものは留めない**（論点3）。 */
const JAPANESE_TEXT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** `node` が `other` より前に在るか（文書の並びで）。 */
function precedes(node: Node, other: Node): boolean {
  return (node.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * `text` を含む要素のうち最も内側のもの。`querySelectorAll` は文書の並びで返すので、
 * 含むもののうち最後に現れるものが最も内側である。
 */
function innermostElementContaining(text: string): Element {
  const found = Array.from(document.body.querySelectorAll('*')).filter((element) =>
    (element.textContent ?? '').includes(text),
  );
  const innermost = found[found.length - 1];
  expect(innermost, `「${text}」を含む要素が無い`).toBeDefined();

  return innermost as Element;
}

/** `text` に `part` が何回現れるか。 */
function occurrencesOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe('献立詳細 MealDetail', () => {
  it('読み込み中は案内だけを出し、記録の操作も注意表示も出さない', () => {
    // 押しても指す献立が画面に無い（規則9）。注意表示は献立と一緒に出るものである。
    renderDetail({ outcome: 'loading' });

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(cookedControl()).toBeNull();
    expect(screen.queryAllByRole('complementary')).toHaveLength(0);
  });

  it('取れなかった回は断りを出し、記録の操作を出さない', () => {
    renderDetail({ outcome: 'failed' });

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(cookedControl()).toBeNull();
  });

  it('断られた回も取れなかった回と同じく、記録の操作を出さない', () => {
    // 画面から指せるのは自世帯の献立だけで、利用者にできることが無い（7章 / C-9）。
    renderDetail({ outcome: 'rejected', rule: 'showMeal.mealNotFound' });

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(cookedControl()).toBeNull();
  });

  it('取れなかった回でも閉じる操作は残す', () => {
    // 閉じられないと、詳細から戻る手段が1つも無くなる。
    let closed = false;
    renderDetail({ outcome: 'failed' }, { onClose: () => (closed = true) });

    fireEvent.click(closeControl() as HTMLElement);

    expect(closed).toBe(true);
  });

  it('献立の名称を第1階層の見出しとして出す', () => {
    // B-63 規則2: 画面の主題は献立の名称であり、材料と手順はその下の階層である。
    renderDetail({ outcome: 'shown', meal: meal({ title: 'にんじんと卵の炒めもの' }) });

    expect(
      screen.getByRole('heading', { level: 1, name: 'にんじんと卵の炒めもの' }),
    ).not.toBeNull();
  });

  it('材料の名称と分量を、主材料が先・調味料が後の並びで出す', () => {
    // 並べ替えそのものは `MealDetailIngredients.ts` の持ち分（規則2 / 画面設計 4章）。
    renderDetail({
      outcome: 'shown',
      meal: meal({
        ingredients: [seasoning('醤油', '大さじ2'), main('豚こま肉', '300g')],
        coverage: { covered: [{ ...main('豚こま肉', '300g'), expiryDate: null }], missing: [] },
      }),
    });

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).queryByText('豚こま肉')).not.toBeNull();
    expect(within(rows[0] as HTMLElement).queryByText('300g')).not.toBeNull();
    expect(within(rows[1] as HTMLElement).queryByText('醤油')).not.toBeNull();
    expect(within(rows[1] as HTMLElement).queryByText('大さじ2')).not.toBeNull();
  });

  it('分量を持たない材料には分量を出さない', () => {
    // ADR-010: 未設定は `null` であり、web で「なし」と補わない。
    renderDetail({
      outcome: 'shown',
      meal: meal({
        ingredients: [main('豚こま肉', null)],
        coverage: { covered: [{ ...main('豚こま肉'), expiryDate: null }], missing: [] },
      }),
    });

    const row = screen.getAllByRole('listitem')[0] as HTMLElement;
    expect(row.textContent).toContain('豚こま肉');
    expect(within(row).queryByText('null')).toBeNull();
    expect(row.textContent).not.toContain('null');
  });

  it('賄える材料と不足する材料に、違う印を出す', () => {
    // NFR-17: 記号と文字の両方で区別する。**色だけに頼らない。**
    renderDetail({
      outcome: 'shown',
      meal: meal({
        ingredients: [main('豚こま肉'), main('しょうが', '1かけ')],
        coverage: {
          covered: [{ ...main('豚こま肉'), expiryDate: null }],
          missing: [main('しょうが', '1かけ')],
        },
      }),
    });

    const rows = screen.getAllByRole('listitem');
    const coveredMark = within(rows[0] as HTMLElement).getByRole('note').textContent;
    const missingMark = within(rows[1] as HTMLElement).getByRole('note').textContent;

    expect(coveredMark).not.toBe(missingMark);
  });

  it('不足の印を文字で出す', () => {
    // NFR-17 / B-63 規則5: 記号はアイコン（飾り）に移り、読み上げに渡るのは文字である。
    // **文言そのものは留めない**（論点3）。
    renderDetail({
      outcome: 'shown',
      meal: meal({
        ingredients: [main('しょうが', '1かけ')],
        coverage: { covered: [], missing: [main('しょうが', '1かけ')] },
      }),
    });

    const mark = within(screen.getAllByRole('listitem')[0] as HTMLElement).getByRole('note')
      .textContent as string;

    expect(mark).toMatch(JAPANESE_TEXT);
  });

  it('調味料には印を出さない', () => {
    // C-16 / ADR-023: 充足判定の対象外であり、**印が無いこと自体が意味を持つ**。
    renderDetail({
      outcome: 'shown',
      meal: meal({
        ingredients: [main('豚こま肉'), seasoning('醤油', '大さじ2')],
        coverage: { covered: [{ ...main('豚こま肉'), expiryDate: null }], missing: [] },
      }),
    });

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).queryAllByRole('note')).toHaveLength(1);
    expect(within(rows[1] as HTMLElement).queryAllByRole('note')).toHaveLength(0);
  });

  it('手順を渡された並びのまま、番号を添えて出す', () => {
    // FR-19 / FR-30: 表示は生成時のまま不変である。
    renderDetail({
      outcome: 'shown',
      meal: meal({ steps: ['白菜を一口大に切る', '醤油とみりんを合わせる'] }),
    });

    const steps = screen.getAllByRole('listitem').slice(1);
    expect(steps[0]?.textContent).toContain('白菜を一口大に切る');
    expect(steps[0]?.textContent).toContain('1');
    expect(steps[1]?.textContent).toContain('醤油とみりんを合わせる');
    expect(steps[1]?.textContent).toContain('2');
  });

  it('手順が0件でも詳細全体を断らず、名称と材料を出す', () => {
    // 規則6: 献立は取れており、断ると材料も読めなくなる。
    renderDetail({ outcome: 'shown', meal: meal({ steps: [] }) });

    expect(screen.getByRole('heading', { name: '豚こま肉と白菜の生姜焼き' })).not.toBeNull();
    expect(screen.queryByText('豚こま肉')).not.toBeNull();
  });

  it('注意表示を必ず1回出す', () => {
    // FR-20 / 規則7: ここは手順と分量を実際に見る画面である。
    renderDetail({ outcome: 'shown', meal: meal() });

    expect(screen.getAllByRole('complementary')).toHaveLength(1);
  });

  it('作ったことを記録する操作は、1度押すだけで届く', () => {
    // 規則8: **確認ダイアログを出さない。** 押し間違えても実害がない。
    let recorded = 0;
    renderDetail({ outcome: 'shown', meal: meal() }, { onAddCookingRecord: () => (recorded += 1) });

    fireEvent.click(cookedControl() as HTMLElement);

    expect(recorded).toBe(1);
  });

  it('送っている間は記録の操作が効かない', () => {
    // 規則10: 2度目の記録を送らない。
    let recorded = 0;
    renderDetail(
      { outcome: 'shown', meal: meal() },
      { recording: true, onAddCookingRecord: () => (recorded += 1) },
    );

    fireEvent.click(cookedControl() as HTMLElement);

    expect(recorded).toBe(0);
  });

  it('送っている間は閉じる操作も効かない', () => {
    // 規則10: 結末が届く前に閉じると、断りの案内が出ないまま成否が分からなくなる。
    let closed = false;
    renderDetail(
      { outcome: 'shown', meal: meal() },
      { recording: true, onClose: () => (closed = true) },
    );

    fireEvent.click(closeControl() as HTMLElement);

    expect(closed).toBe(false);
  });

  it('記録が通った回は案内を1つ出す', () => {
    // 規則11・12: これは「いまの1回」の結末であり、開き直した回には出ない。
    renderDetail({ outcome: 'shown', meal: meal() }, { recorded: true });

    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('記録が断られた回も案内を1つ出す', () => {
    // 文言を選ぶのは `cookingRecordFailureNoticeOf` の読みである（規則13）。
    renderDetail({ outcome: 'shown', meal: meal() }, { recordFailureNotice: 'unavailable' });

    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('記録が通っても、記録の操作は同じ位置に残る', () => {
    // FR-31 の前半。記録済みの表示を足しても操作は消さない（B-53b 規則9）。
    renderDetail({ outcome: 'shown', meal: meal() }, { recorded: true });

    expect(cookedControl()).not.toBeNull();
  });

  it('何も無い回は案内を1つも出さない', () => {
    // 記録の案内は結末があるときだけである（規則11）。
    renderDetail({ outcome: 'shown', meal: meal() });

    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  describe('記録済みの表示（B-53b）', () => {
    it('記録のある献立を開いたら、記録済みの表示を出す', () => {
      // FR-31 の後半 / B-53b 規則8 / ADR-070: `cooked` は開いた時点の事実である。
      const withoutRecord = bodyTextOf({ outcome: 'shown', meal: meal({ cooked: false }) });
      const withRecord = bodyTextOf({ outcome: 'shown', meal: meal({ cooked: true }) });

      expect(addedTextOf(withoutRecord, withRecord)).not.toBe('');
    });

    it('記録の無い献立を開いただけでは、記録済みの表示を出さない', () => {
      // B-53b 規則8: `cooked` も `recorded` も偽なら、表示の根拠が無い。
      const indicator = cookedIndicator();

      renderDetail({ outcome: 'shown', meal: meal({ cooked: false }) }, { recorded: false });

      expect(document.body.textContent).not.toContain(indicator);
      expect(screen.queryAllByRole('status')).toHaveLength(0);
    });

    it('記録の無い献立でも、この画面で記録が通ったら記録済みの表示を出す', () => {
      // B-53b 規則8 / ADR-070 結果3: 門は記録のあとに詳細を取り直さないので、`recorded` で補う。
      const indicator = cookedIndicator();

      const text = bodyTextOf(
        { outcome: 'shown', meal: meal({ cooked: false }) },
        { recorded: true },
      );

      expect(text).toContain(indicator);
    });

    it('記録済みの表示は文字で出す', () => {
      // NFR-17 / B-53b 規則10: 色だけで示さない。**文言そのものは留めない**（論点3）。
      const indicator = cookedIndicator();

      expect(indicator).toMatch(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u);
    });

    it('記録済みの表示を読み上げの割り込みにしない', () => {
      // B-53b 規則10: 利用者の操作の結末ではなく開いた時点の事実であり、`status` は記録の
      // 結末の案内が使っている。
      renderDetail(
        { outcome: 'shown', meal: meal({ cooked: true }) },
        { recorded: false, recordFailureNotice: null },
      );

      expect(screen.queryAllByRole('status')).toHaveLength(0);
    });

    it('記録済みの献立でも、記録が通った案内は別に1つ出す', () => {
      // B-53b 規則11: 記録が通った案内を記録済みの表示で置き換えない。
      const indicator = cookedIndicator();

      renderDetail({ outcome: 'shown', meal: meal({ cooked: true }) }, { recorded: true });

      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(document.body.textContent).toContain(indicator);
    });

    it('記録済みの献立でも、記録の操作は同じ位置に残り、押せば届く', () => {
      // FR-31 の前半 / 画面設計 4章 / B-53b 規則9: 記録済みでも操作を消さず、無効にもしない。
      let recorded = 0;
      renderDetail(
        { outcome: 'shown', meal: meal({ cooked: true }) },
        { onAddCookingRecord: () => (recorded += 1) },
      );

      fireEvent.click(cookedControl() as HTMLElement);

      expect(recorded).toBe(1);
    });

    it('取れなかった回は、記録が通った直後でも記録済みの表示を出さない', () => {
      // B-53b 規則9 / 設計 7章: 記録済みの表示は取れた献立の枝にだけ出す。
      const afterRecord = bodyTextOf({ outcome: 'failed' }, { recorded: true });
      const beforeRecord = bodyTextOf({ outcome: 'failed' }, { recorded: false });

      expect(afterRecord).toBe(beforeRecord);
    });

    it('読み込み中は、記録が通った直後でも記録済みの表示を出さない', () => {
      // B-53b 規則9: 読み込み中は献立が画面に無い。
      const afterRecord = bodyTextOf({ outcome: 'loading' }, { recorded: true });
      const beforeRecord = bodyTextOf({ outcome: 'loading' }, { recorded: false });

      expect(afterRecord).toBe(beforeRecord);
    });

    it('記録があり、この画面でも記録が通ったとき、記録済みの表示は1つだけ出す', () => {
      // B-53b 規則8: 両方が真でも重ねて出さない。
      const indicator = cookedIndicator();

      const text = bodyTextOf(
        { outcome: 'shown', meal: meal({ cooked: true }) },
        { recorded: true },
      );

      expect(occurrencesOf(text, indicator)).toBe(1);
    });
  });

  describe('見た目の構造（B-63）', () => {
    it('閉じる操作は「戻る」という名前で引ける', () => {
      // B-63 規則3・5: アイコンは飾りであり、意味は `aria-label` が運ぶ。
      let closed = false;
      renderDetail({ outcome: 'shown', meal: meal() }, { onClose: () => (closed = true) });

      fireEvent.click(screen.getByRole('button', { name: '戻る' }));

      expect(closed).toBe(true);
    });

    it('閉じる操作は見える文字を持たず、名前だけを持つ', () => {
      // B-63 規則3・5: 見えるのはアイコンだけで、名前は読み上げにだけ渡す。
      renderDetail({ outcome: 'shown', meal: meal() });

      expect(screen.getByRole('button', { name: '戻る' }).textContent).toBe('');
    });

    it('材料と手順の見出しを第2階層で2つ出す', () => {
      // B-63 規則2: 献立の名称（第1階層）の下に材料と手順が並ぶ。
      renderDetail({ outcome: 'shown', meal: meal() });

      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
    });

    it('材料の見出しは手順の見出しより前に出る', () => {
      // B-63 規則2: 1つ目の見出しが材料の一覧の上、2つ目がその下（手順の側）に在る。
      renderDetail({ outcome: 'shown', meal: meal() });

      const [ingredientsHeading, stepsHeading] = screen.getAllByRole('heading', { level: 2 });
      const ingredientsList = screen.getAllByRole('list')[0] as HTMLElement;
      // 見出しが1つしか無いと、並びを比べる相手が無いまま型の誤りで落ちる。
      expect(stepsHeading, '第2階層の見出しが2つ無い').toBeDefined();

      expect(precedes(ingredientsHeading as HTMLElement, ingredientsList)).toBe(true);
      expect(precedes(ingredientsList, stepsHeading as HTMLElement)).toBe(true);
    });

    it('賄える材料の印も読み上げに渡る文字を持つ', () => {
      // NFR-17 / B-63 規則5: チェックのアイコンは飾りであり、それだけでは読み上げに何も渡らない。
      renderDetail({
        outcome: 'shown',
        meal: meal({
          ingredients: [main('豚こま肉', '300g')],
          coverage: { covered: [{ ...main('豚こま肉', '300g'), expiryDate: null }], missing: [] },
        }),
      });

      const mark = within(screen.getAllByRole('listitem')[0] as HTMLElement).getByRole('note')
        .textContent as string;

      expect(mark).toMatch(JAPANESE_TEXT);
    });

    it('主材料と調味料を別の一覧に分けて出す', () => {
      // B-63 規則6 / C-16: 調味料は区切りの下に印なしで並ぶ。
      renderDetail({
        outcome: 'shown',
        meal: meal({
          ingredients: [seasoning('醤油', '大さじ2'), main('豚こま肉', '300g')],
          coverage: { covered: [{ ...main('豚こま肉', '300g'), expiryDate: null }], missing: [] },
        }),
      });

      const [mainList, seasoningList] = screen.getAllByRole('list');

      expect(within(mainList as HTMLElement).queryByText('豚こま肉')).not.toBeNull();
      expect(within(mainList as HTMLElement).queryByText('醤油')).toBeNull();
      expect(within(seasoningList as HTMLElement).queryByText('醤油')).not.toBeNull();
    });

    it('主材料と調味料の両方があるとき、2つの一覧の間に区切り線を1つ出す', () => {
      // B-63 規則6: 区切りは `<hr>`（役割 `separator`）で、主材料の一覧と調味料の一覧の間に在る。
      renderDetail({
        outcome: 'shown',
        meal: meal({
          ingredients: [seasoning('醤油', '大さじ2'), main('豚こま肉', '300g')],
          coverage: { covered: [{ ...main('豚こま肉', '300g'), expiryDate: null }], missing: [] },
        }),
      });

      const separators = screen.queryAllByRole('separator');
      expect(separators).toHaveLength(1);

      const [mainList, seasoningList] = screen.getAllByRole('list');
      const separator = separators[0] as HTMLElement;

      expect(precedes(mainList as HTMLElement, separator)).toBe(true);
      expect(precedes(separator, seasoningList as HTMLElement)).toBe(true);
    });

    it('調味料が無い献立には区切り線を出さない', () => {
      // B-63 規則6: 区切る相手が無い。
      renderDetail({ outcome: 'shown', meal: meal({ ingredients: [main('豚こま肉', '300g')] }) });

      expect(screen.queryAllByRole('separator')).toHaveLength(0);
    });

    it('記録済みの表示を記録の操作より前に出す', () => {
      // B-63 規則10: 置き場は記録の操作の上（原本）。
      const indicator = cookedIndicator();

      renderDetail({ outcome: 'shown', meal: meal({ cooked: true }) });

      expect(precedes(innermostElementContaining(indicator), cookedControl() as HTMLElement)).toBe(
        true,
      );
    });

    it('記録が通った案内は、記録済みの表示と記録の操作の間に出す', () => {
      // B-63 規則10: 案内（`status`）は記録済みの表示と操作の間に置く。
      const indicator = cookedIndicator();

      renderDetail({ outcome: 'shown', meal: meal({ cooked: false }) }, { recorded: true });

      const notice = screen.getByRole('status');

      expect(precedes(innermostElementContaining(indicator), notice)).toBe(true);
      expect(precedes(notice, cookedControl() as HTMLElement)).toBe(true);
    });
  });
});
