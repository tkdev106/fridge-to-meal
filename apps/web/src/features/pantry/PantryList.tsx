/**
 * 在庫一覧の画面（B-11 設計 4章 / 6章 規則9〜11）。`docs/screen-design.md` 第5章に当たる。
 *
 * ここは `PantrySections.ts` と `RemainingDays.ts` を読むだけの薄い層である。帯の判定も
 * 並べ替えも持たない（規則7）— **描いて確かめられるようになった今も**（ADR-052）、判断は
 * 純粋関数に置くほうが速く、仮の文言にも jsdom にも依存しない。**出し分けそのもの**
 * （3値のどれを描くか・0件なら帯を出さないこと）は切り出せないので、
 * `apps/web/test/features/pantry/PantryList.test.tsx` が描いて確かめる。
 *
 * 反対に、**日本語はここにしか置かない**（規則10）。文言も配色も未確定であり
 * （同書 論点3）、純粋関数に持たせるとテストが仮の文言を固定してしまう。
 *
 * **受け取るのは読み込みの結末である**（B-22 設計 5章 / 規則2）。在庫品の列そのものではなく、
 * 「読み込み中／取れた／取れなかった」の3値を受け取り、出し分けだけを行う。取りに行くのは
 * `apps/web/src/server/` の継ぎ目で、それを呼ぶのは `App.tsx` である。
 *
 * **削除は確認を挟む**（B-69 / FR-06 / `docs/screen-design.md` 論点4 #1）。なぞると行の `削除` が
 * 現れ、行末の `…` を開くと `編集` / `削除` が出る。どちらの `削除` も同じ確認
 * （`StockItemDeleteConfirmation`）を開き、**消すのは確認の `削除` を押したときだけである。**
 * どの出来事でどの状態へ移るかは `RowOperations.ts` が持ち、ここはその状態を1つ持って配線する。
 *
 * **確認を出している間は、一覧（帯・行・削除の断りの案内）を `inert` にする**（B-64 設計 規則9 /
 * 論点4 #1）。確認はその包みの外に置く。見出しの行と下タブの帯は `inert` にしない — 状態を
 * 持つのはここであり、外へ出すと持ち方が動く（同 10章）。届かないことは暗幕と確認の Tab の巡回が担う。
 *
 * **見た目の値は `PantryList.module.css` にだけ置く**（ADR-055 決定1 / B-64 設計 規則12）。
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { StockItemDto } from '@fridge-to-meal/contract';
import type { DeleteFailureNotice } from './DeleteFailureNotice.js';
import { deleteFailureNoticeOf } from './DeleteFailureNotice.js';
import { remainingDaysLabelOf } from './ExpiryDateLabel.js';
import type { ExpirySection, ListedStockItem } from './PantrySections.js';
import { pantrySectionsOf } from './PantrySections.js';
import type { RowOperationEvent, RowOperations } from './RowOperations.js';
import { IDLE, nextRowOperations, opensEditOnTap } from './RowOperations.js';
import { StockItemDeleteConfirmation } from './StockItemDeleteConfirmation.js';
import type { SwipePoint } from './SwipeGesture.js';
import { isDeleteSwipe, isTap } from './SwipeGesture.js';
import styles from './PantryList.module.css';
import { Icon } from '../../icons/Icon.js';
import { useBackHandler } from '../../backNavigation/BackHandler.js';
import type { DeleteStockItem, StockItemsOutcome } from '../../server/StockItemRequests.js';

/**
 * 帯の見出し。**見出し自体がテキストの警告**になっていることで、色を使わなくても
 * 期限の近さが読める（NFR-17 / screen-design 5章）。文言はデザインが正である
 * （ADR-074 結果1 / B-64 設計 規則3）。
 */
const SECTION_HEADINGS: Record<ExpirySection, string> = {
  urgent: '今日まで',
  soon: '期限が近い',
  rest: 'その他',
};

/**
 * 見出しに `!` を添える帯（B-64 設計 規則3）。最も急ぐ帯だけである。`!` は `aria-hidden` で
 * 見出しの名前に入れない — 名前は文だけが運ぶ（先行 B-68 規則9 の断りの記号）。
 */
const ALERTED_SECTIONS: ReadonlySet<ExpirySection> = new Set(['urgent']);

/** 帯ごとの見た目（見出しの文字色・残日数の色）。値は module の側にある（B-64 設計 規則3・5）。 */
const SECTION_CLASSES: Record<ExpirySection, { band: string; remainingDays: string }> = {
  urgent: { band: styles.bandUrgent ?? '', remainingDays: styles.remainingDaysUrgent ?? '' },
  soon: { band: styles.bandSoon ?? '', remainingDays: styles.remainingDaysSoon ?? '' },
  rest: { band: styles.bandRest ?? '', remainingDays: styles.remainingDaysRest ?? '' },
};

/** 期限が未設定のときに残日数の欄へ出す印（FR-13 / screen-design 5章）。 */
const NO_REMAINING_DAYS_MARK = '－';

/** 在庫が0件のときの案内。登録の導線そのものは B-12 で置くので、ここは文言だけ。 */
const EMPTY_NOTICE = '冷蔵庫の中身がまだ登録されていません。登録すると、ここに並びます。';

/**
 * 読み込み中の案内（B-22 設計 7章 / 10章。**暫定**）。
 *
 * **0件の案内を出さない。** 在庫があるのに無いように見せてしまう。
 * `docs/screen-design.md` は在庫一覧の読み込み中の見せ方を決めていない（同書 9章の表は
 * オフラインの帯・LLM の縮退・生成の失敗だけ）ため、文言もこの1行も仮である。
 */
const LOADING_NOTICE = '在庫を読み込んでいます。';

/**
 * 取れなかったときの断り（B-22 設計 7章 / 10章。**暫定**）。
 *
 * **原因を断定しない** — 継ぎ目は通信の失敗・401・500・壊れた応答をすべて1つの結末に畳んで
 * おり（同 規則9）、ここに見分けられる材料は無い。**再試行の手段も置かない**（規則10。
 * 自動でも取りに行き直さない）。**取得の側は B-24 のあともこのままである** — `rule` から文言を
 * 選ぶのは登録だけと決まった（`RegisterFailureNotice.ts` / ADR-032 決定3）。一覧が取れない原因は
 * どれも利用者の入力では直せず、言い分ける先が無い。
 */
const LOAD_FAILURE_NOTICE = '在庫を読み込めませんでした。';

/**
 * 消せなかったときの断り（FR-06 / B-23。**暫定**）。**断りの種類から選ぶ**
 * （ADR-032 決定3）— 選ぶ判断は `DeleteFailureNotice.ts` にあり、ここはその識別子に文言を
 * 当てるだけである。
 *
 * **原因を断定しない。** 認証の断りもサーバ側の不備も通信の失敗もここに落ちており、
 * 見分ける材料が無い（取れなかったときの断りと同じ構え）。**「すでに消えている」ときは
 * ここへ来ない** — 案内そのものを出さない（ADR-050）。
 */
const NOTICES: Record<DeleteFailureNotice, string> = {
  unavailable: 'いま消せませんでした。もう一度お試しください。',
};

/**
 * 残日数を読める文にする（NFR-17 / screen-design 9章の「今日」「あと2日」）。
 * 数から文への言い換えは編集の画面と共有する `remainingDaysLabelOf` に任せ（B-64c）、
 * ここが持つのは期限なしの印だけである。どの帯に入るかはここで決めない（規則5 は純粋関数の側）。
 */
function remainingDaysText(remainingDays: number | null): string {
  if (remainingDays === null) return NO_REMAINING_DAYS_MARK;

  return remainingDaysLabelOf(remainingDays);
}

/**
 * 押し始めが行の中の操作（`…`・開いた中身の2つ・現れた `削除`）の上か（B-69 設計 規則7）。
 * そうなら行の動きとして読まない — 押した操作だけが効く。
 */
function startsOnOperation(target: EventTarget): boolean {
  return target instanceof Element && target.closest('button') !== null;
}

/** 行に出ているもの（B-69 設計 規則2・3）。出るのは1度に1つだけである。 */
type RowShowing = 'nothing' | 'revealed' | 'operationsOpen';

/**
 * 一覧の1行。**なぞると `削除` が現れ、タップで編集を開き、行末の `…` から `編集` / `削除` に
 * 届く**（FR-06 / FR-05 / B-69 設計 規則1・3・4 / `docs/screen-design.md` 5章 と 2章
 * `pantry --> edit`）。**なぞっただけでは消えない** — 消すのは確認の `削除` である（規則1）。
 *
 * 押した点と離した点の2つだけを覚え、**スワイプと読むか・タップと読むかの判断は
 * `SwipeGesture.ts` が持つ**（規則7 / B-55 設計 規則15）。**2つの閾値の間には隙間があり**
 * （8px と 64px）、どちらにも当たらない中途半端な動きでは何も起こさない。
 *
 * **`…` はどの幅でも置く**（B-69 規則3）。キーボードと読み上げから編集・削除に届く経路は
 * これであり、なぞる・タップはポインタにしかできない。開いた中身は DOM で `…` の直後に置き、
 * Tab で届く。矢印キーの移動を約束する役割は使わず、開閉ボタンの形にする。
 *
 * ポインタのイベントは触れる相手を問わない（指・マウス・ペン）ので、ジェスチャの依存を
 * 足さずに済む（`docs/workflow.md` 3章）。
 */
function StockItemRow({
  row,
  section,
  showing,
  onEvent,
  onTap,
  onEdit,
  registerToggle,
  focusToggle,
}: {
  row: ListedStockItem;
  /** 行が入っている帯。残日数の色を選ぶためだけに使う（B-64 設計 5章 / 規則5）。 */
  section: ExpirySection;
  showing: RowShowing;
  onEvent: (event: RowOperationEvent) => void;
  onTap: (stockItem: StockItemDto) => void;
  onEdit: (stockItem: StockItemDto) => void;
  registerToggle: (id: string, toggle: HTMLButtonElement | null) => void;
  focusToggle: (id: string) => void;
}) {
  // 覚えるだけで描き直す必要が無いので state にしない。
  const pressedPoint = useRef<SwipePoint | null>(null);
  const operationsId = useId();
  const { stockItem } = row;
  const rowClass = [
    styles.row,
    showing === 'revealed' ? styles.rowRevealed : '',
    showing === 'operationsOpen' ? styles.rowOperationsOpen : '',
  ]
    .filter((name) => name !== '' && name !== undefined)
    .join(' ');
  // 期限なしの `－` は弱い文字色、それ以外は帯の文字色（B-64 設計 規則5）。色は文に添えるだけである。
  const remainingDaysClass =
    row.remainingDays === null ? styles.remainingDaysNone : SECTION_CLASSES[section].remainingDays;

  return (
    <li
      className={rowClass}
      // 縦は送り、横はこちらで受け取る（`SwipeGesture.ts`）。指定しないと、横へ引いた指も
      // 送りとして browser に取られ、離上が届かないことがある。
      style={{ touchAction: 'pan-y' }}
      onPointerDown={(event) => {
        // 押し始めが行の中の操作の上なら、捕捉もせず覚えもしない（B-69 規則7）。行が捕捉すると、
        // ブラウザによっては中のボタンの click の行き先が行に変わる（B-69 設計 10章）。
        if (startsOnOperation(event.target)) {
          pressedPoint.current = null;
          return;
        }

        pressedPoint.current = { x: event.clientX, y: event.clientY };
        // 行の外で指を離しても離上がこの行に届くようにする。届かないと、押した点が
        // 残ったまま次の操作と混ざる。
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        const startPoint = pressedPoint.current;
        pressedPoint.current = null;

        if (startPoint === null) return;

        const endPoint = { x: event.clientX, y: event.clientY };

        // スワイプとタップは**どちらか一方しか成り立たない**（B-55 設計 規則15）。先に見るほうを
        // 決めているのは読みやすさのためだけで、順序に意味を持たせていない。
        if (isDeleteSwipe(startPoint, endPoint)) {
          onEvent({ kind: 'swiped', stockItemId: stockItem.id });
          return;
        }

        if (isTap(startPoint, endPoint)) onTap(stockItem);
      }}
      // 送りに取られた・指が外れたなどで離上が来ない回は、押した点を捨てる。
      onPointerCancel={() => {
        pressedPoint.current = null;
      }}
    >
      {/* 行の中身（名称・分量・残日数・`…`）。なぞった行ではこれを左へずらし、下の `削除` を
          見せる（B-64 設計 規則7）。 */}
      <div className={styles.rowContent}>
        <span className={styles.name}>{stockItem.name}</span>
        {/* 分量が無い行も欄は空のまま置き、列をずらさない。`null` も `－` も文字にしない
            （B-64 設計 規則4 / FR-13）。 */}
        <span className={styles.amount}>{stockItem.amount ?? ''}</span>
        {/* 期限の表現は色に頼らず、必ずテキストを出す（NFR-17）。 */}
        <span className={`${styles.remainingDays} ${remainingDaysClass}`}>
          {remainingDaysText(row.remainingDays)}
        </span>
        <button
          ref={(toggle) => {
            registerToggle(stockItem.id, toggle);
          }}
          type="button"
          className={styles.toggle}
          aria-label="操作"
          aria-expanded={showing === 'operationsOpen'}
          aria-controls={operationsId}
          onClick={() => {
            onEvent({ kind: 'operationsToggled', stockItemId: stockItem.id });
          }}
          // 開いた直後は焦点が `…` に残る。ここでの Esc も開いた中身を閉じる（開閉ボタンの形）。
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || showing !== 'operationsOpen') return;

            event.preventDefault();
            onEvent({ kind: 'dismissed' });
          }}
        >
          {/* 名前は `aria-label` の `操作` が運ぶ（B-64 設計 規則6）。 */}
          <Icon name="more" size={24} />
        </button>
      </div>
      {showing === 'operationsOpen' && (
        <div
          id={operationsId}
          className={styles.operations}
          // 開いた中身を Esc で閉じたら、焦点はその行の `…` に戻す（B-69 規則13 / NFR-16）。
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;

            event.preventDefault();
            onEvent({ kind: 'dismissed' });
            focusToggle(stockItem.id);
          }}
        >
          <button
            type="button"
            className={styles.operation}
            onClick={() => {
              onEvent({ kind: 'dismissed' });
              onEdit(stockItem);
            }}
          >
            編集
          </button>
          <button
            type="button"
            className={`${styles.operation} ${styles.operationDanger}`}
            onClick={() => {
              onEvent({ kind: 'deleteChosen', stockItem });
            }}
          >
            削除
          </button>
        </div>
      )}
      {showing === 'revealed' && (
        <button
          type="button"
          className={styles.revealedDelete}
          onClick={() => {
            onEvent({ kind: 'deleteChosen', stockItem });
          }}
        >
          削除
        </button>
      )}
    </li>
  );
}

/**
 * 画面が受け取る3値（B-22 設計 5章）。取得の結末に「読み込み中」を1つ足しただけのもので、
 * `failed` の中身は継ぎ目が畳んだままである（規則9）。
 */
export type PantryListState = { readonly outcome: 'loading' } | StockItemsOutcome;

/**
 * 行の `…` へ焦点を移す求め（B-65b 設計 5章 / 規則7）。**参照が変わるたびに1度移す** — 同じ行を
 * 2度続けて戻せるよう、呼び出し側は求めるたびに新しい値を作る（10章 前提5）。
 */
export type FocusOperationsRequest = { readonly stockItemId: string };

export type PantryListProps = {
  stockItems: PantryListState;
  /**
   * 削除の実行（FR-06 / B-23）。**結末で返り、例外を投げない**（`server/README.md`）。
   * 送り先も認証もこの画面は知らない。**一覧を取り直すのは呼び出し側**（`App.tsx`）である。
   */
  onDelete: DeleteStockItem;
  /**
   * 行をタップしたときに、その行の在庫品を渡す先（FR-05 / B-55 設計 5章 / 規則15）。
   * **開くかどうかを決めるのは呼び出し側**（`PantryTab`）であり、この画面は編集の画面を知らない。
   *
   * **触っただけでは消えない**（規則15 / FR-06）— タップと削除のスワイプは閾値で分かれており、
   * 片方が起きた回にもう片方は起きない。行末の `…` の `編集` もここへ渡す（B-69 規則6）。
   * **何かが出ているときのタップは渡さない**（B-69 規則4）。
   */
  onEdit: (stockItem: StockItemDto) => void;
  /**
   * 残日数を数える基準日（`YYYY-MM-DD`）。**呼び出し側が渡す。**
   * ここで `new Date()` を読むと、現在時刻が本体に埋まる（docs/testing.md 5章）。
   * 実行環境の暦日を作るのは `todayOf` の仕事で、それを呼ぶのは `App.tsx` である。
   */
  today: string;
  /** 接続が切れているか（B-70 / FR-41）。省略は `false`。 */
  offline?: boolean;
  /**
   * 新しい値を受け取るたびに、その在庫品の行の `…` へ焦点を移す（B-65b 設計 規則7）。在庫タブが
   * 登録・編集のパネルを閉じた回に渡す。**行がもう無ければ移さない**（7章 / B-69 規則13）。
   * 省略は `null`（求めなし）。
   */
  focusOperationsRequest?: FocusOperationsRequest | null;
};

export function PantryList({
  stockItems,
  today,
  onDelete,
  onEdit,
  offline = false,
  focusOperationsRequest = null,
}: PantryListProps) {
  const [notice, setNotice] = useState<DeleteFailureNotice | null>(null);
  const [rowOperations, setRowOperations] = useState<RowOperations>(IDLE);
  // 送っている間は次の削除を送らない。描き直す必要が無いので state にしない。
  const deleting = useRef(false);
  // 行ごとの `…`。確認を閉じたときに焦点を戻す先である（B-69 規則13）。行が木から外れれば
  // 消えるので、消えた行へは戻さない。
  const toggles = useRef(new Map<string, HTMLButtonElement>());

  function registerToggle(id: string, toggle: HTMLButtonElement | null) {
    if (toggle === null) toggles.current.delete(id);
    else toggles.current.set(id, toggle);
  }

  function focusToggle(id: string) {
    toggles.current.get(id)?.focus();
  }

  // 求めは描いたあとに移す — 呼び出し側が同じ描画で一覧の側の `inert` を外しており、`inert` の
  // 中の要素には焦点が乗らないため（B-65b 設計 規則7）。早い return より前に置く（フックの順序）。
  useEffect(() => {
    if (focusOperationsRequest !== null) focusToggle(focusOperationsRequest.stockItemId);
  }, [focusOperationsRequest]);

  // 状態が指す行が取り直しで消えていれば、何も出ていないものとして扱う（B-69 規則15）。
  // **確認だけは別である** — 開いた時点の在庫品を抱えて出し続ける（規則12）。
  // 一覧を描かない回（読み込み中・取れなかった・0件）は、何も出ていない。
  const current: RowOperations =
    stockItems.outcome !== 'loaded' || stockItems.stockItems.length === 0
      ? IDLE
      : (rowOperations.kind === 'revealed' || rowOperations.kind === 'operationsOpen') &&
          !stockItems.stockItems.some((listed) => listed.id === rowOperations.stockItemId)
        ? IDLE
        : rowOperations;

  function dispatch(event: RowOperationEvent) {
    setRowOperations(nextRowOperations(current, event));
  }

  // 端末の戻るは、出ているもの（現れた `削除`・開いた `…`・確認）を Esc・やめると同じ口で
  // 閉じる（B-75 規則1・2）。焦点も同じくその行の `…` に戻す（B-69 規則13）。何も出ていない
  // 間は登録しない。閉じるのは書き込みではないので、接続が切れていても止めない（規則11）。
  useBackHandler(current.kind !== 'idle', () => {
    dispatch({ kind: 'dismissed' });
    if (current.kind === 'confirming') focusToggle(current.stockItem.id);
    else if (current.kind === 'operationsOpen') focusToggle(current.stockItemId);
  });

  function deleteRow(id: string) {
    // 二重に送っても2度目は 404 になり、それを「すでに消えている」と読む（ADR-050）ので
    // 害は無いが、往復を1つ無駄にする。
    if (deleting.current) return;
    // **接続が切れている間は送らない**（B-70 規則11）。確認の `削除` は `disabled` になって
    // いるので、ここは最後の守りである。断りの案内も出さない（理由は門の帯が既に示している）。
    // なぞる・確認を開く・やめる・タップで編集を開くことは止めない（規則6）。
    if (offline) return;

    deleting.current = true;
    setNotice(null);

    // **`catch` を置かない。** 口は結末で返し投げない（`server/README.md`）ので、握り潰すと
    // 本当の不具合が案内に化ける。`finally` だけは残す — 投げられた回に操作が戻らなくなるため。
    void (async () => {
      try {
        // 消えたと読めた回は案内を出さない（`DeleteFailureNotice.ts`）。一覧は
        // `App.tsx` が同じ読みで取り直すので、ここで列から抜かない（B-22 設計 規則3）。
        setNotice(deleteFailureNoticeOf(await onDelete(id)));
      } finally {
        deleting.current = false;
      }
    })();
  }

  // 出し分けだけを行い、計算を持たない（B-22 設計 8章末尾 / B-11 設計 規則7）。
  if (stockItems.outcome === 'loading') return <p className={styles.notice}>{LOADING_NOTICE}</p>;
  if (stockItems.outcome === 'failed')
    return <p className={styles.notice}>{LOAD_FAILURE_NOTICE}</p>;

  const sections = pantrySectionsOf(stockItems.stockItems, today);

  // 在庫品が0件なら帯を1つも出さない（規則11）。行の操作も描かない（B-69 規則16）。
  if (sections.length === 0) return <p className={styles.notice}>{EMPTY_NOTICE}</p>;

  function showingOf(id: string): RowShowing {
    if (current.kind === 'revealed' && current.stockItemId === id) return 'revealed';
    if (current.kind === 'operationsOpen' && current.stockItemId === id) return 'operationsOpen';

    return 'nothing';
  }

  function tapRow(stockItem: StockItemDto) {
    // 何かが出ているときのタップはそれを閉じるだけで、編集を開かない（B-69 規則4）。
    if (opensEditOnTap(current)) onEdit(stockItem);
    dispatch({ kind: 'tapped' });
  }

  return (
    <div>
      {/* 確認を出している間は、帯・行・削除の断りの案内を `inert` にする（B-64 設計 規則9）。
          確認（暗幕と `role="dialog"`）はこの包みの外に置く。 */}
      <div className={styles.sections} inert={current.kind === 'confirming'}>
        {notice !== null && <p className={styles.notice}>{NOTICES[notice]}</p>}

        {sections.map((section) => (
          <section key={section.section}>
            <h2 className={`${styles.band} ${SECTION_CLASSES[section.section].band}`}>
              {ALERTED_SECTIONS.has(section.section) && (
                <span className={styles.alertMark} aria-hidden="true">
                  !
                </span>
              )}
              <span>{SECTION_HEADINGS[section.section]}</span>
              {/* 件数は見た目の手がかりで、読み上げは一覧の件数が運ぶ。 */}
              <span className={styles.bandCount} aria-hidden="true">
                {section.stockItems.length}
              </span>
            </h2>
            <ul className={styles.rows}>
              {section.stockItems.map((row) => (
                <StockItemRow
                  key={row.stockItem.id}
                  row={row}
                  section={section.section}
                  showing={showingOf(row.stockItem.id)}
                  onEvent={dispatch}
                  onTap={tapRow}
                  onEdit={onEdit}
                  registerToggle={registerToggle}
                  focusToggle={focusToggle}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {current.kind === 'confirming' && (
        <StockItemDeleteConfirmation
          stockItem={current.stockItem}
          // 接続が切れている間は確定だけを止める（B-70 規則11 / FR-41）。確認は開いたまま残る。
          confirmDisabled={offline}
          onCancel={() => {
            dispatch({ kind: 'dismissed' });
            // 焦点はその行の `…` に戻す。行がもう無ければ戻さない（B-69 規則13）。
            focusToggle(current.stockItem.id);
          }}
          onConfirm={() => {
            // 確認を閉じてから、**抱えている在庫品の識別子で**送る（B-69 規則11・12）。一覧から
            // 消えていれば `delete.notFound` になり、消えたと読む（ADR-050）。
            dispatch({ kind: 'confirmed' });
            deleteRow(current.stockItem.id);
          }}
        />
      )}
    </div>
  );
}
