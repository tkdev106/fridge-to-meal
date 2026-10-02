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
 */

import { useRef, useState } from 'react';
import type { StockItemDto } from '@fridge-to-meal/contract';
import type { DeleteFailureNotice } from './DeleteFailureNotice.js';
import { deleteFailureNoticeOf } from './DeleteFailureNotice.js';
import type { ExpirySection, ListedStockItem } from './PantrySections.js';
import { pantrySectionsOf } from './PantrySections.js';
import type { SwipePoint } from './SwipeGesture.js';
import { isDeleteSwipe, isTap } from './SwipeGesture.js';
import type { DeleteStockItem, StockItemsOutcome } from '../../server/StockItemRequests.js';

/**
 * 帯の見出し。**見出し自体がテキストの警告**になっていることで、色を使わなくても
 * 期限の近さが読める（NFR-17 / screen-design 5章）。以下すべて仮の文言である。
 */
const SECTION_HEADINGS: Record<ExpirySection, string> = {
  urgent: '期限 今日まで',
  soon: '期限が近い',
  rest: 'その他',
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
 * 数から文への言い換えだけを行い、どの帯に入るかはここで決めない（規則5 は純粋関数の側）。
 */
function remainingDaysText(remainingDays: number | null): string {
  if (remainingDays === null) return NO_REMAINING_DAYS_MARK;
  if (remainingDays === 0) return '今日';
  if (remainingDays < 0) return `${-remainingDays}日過ぎ`;

  return `あと${remainingDays}日`;
}

/**
 * 一覧の1行。**なぞって消し、タップで編集を開く**（FR-06 / FR-05 / `docs/screen-design.md`
 * 5章 と 2章 `pantry --> edit`。どちらも確認は出さない）。
 *
 * 押した点と離した点の2つだけを覚え、**削除と読むか・タップと読むかの判断は
 * `SwipeGesture.ts` が持つ**（規則7 / B-55 設計 規則15）。**2つの閾値の間には隙間があり**
 * （8px と 64px）、どちらにも当たらない中途半端な動きでは何も起こさない — 取り消しの無い
 * 削除と編集の画面が同時に起きないことは、**距離の取り方だけで**保たれている。
 *
 * ポインタのイベントは触れる相手を問わない（指・マウス・ペン）ので、ジェスチャの依存を
 * 足さずに済む（`docs/workflow.md` 3章）。
 */
function StockItemRow({
  row,
  onSwipe,
  onTap,
}: {
  row: ListedStockItem;
  onSwipe: (id: string) => void;
  onTap: (stockItem: StockItemDto) => void;
}) {
  // 覚えるだけで描き直す必要が無いので state にしない。
  const pressedPoint = useRef<SwipePoint | null>(null);

  return (
    <li
      // 縦は送り、横はこちらで受け取る（`SwipeGesture.ts`）。指定しないと、横へ引いた指も
      // 送りとして browser に取られ、離上が届かないことがある。
      style={{ touchAction: 'pan-y' }}
      onPointerDown={(event) => {
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

        // 削除とタップは**どちらか一方しか成り立たない**（B-55 設計 規則15）。先に見るほうを
        // 決めているのは読みやすさのためだけで、順序に意味を持たせていない。
        if (isDeleteSwipe(startPoint, endPoint)) {
          onSwipe(row.stockItem.id);
          return;
        }

        if (isTap(startPoint, endPoint)) onTap(row.stockItem);
      }}
      // 送りに取られた・指が外れたなどで離上が来ない回は、押した点を捨てる。
      onPointerCancel={() => {
        pressedPoint.current = null;
      }}
    >
      <span>{row.stockItem.name}</span>
      {row.stockItem.amount !== null && <span>{row.stockItem.amount}</span>}
      {/* 期限の表現は色に頼らず、必ずテキストを出す（NFR-17）。 */}
      <span>{remainingDaysText(row.remainingDays)}</span>
    </li>
  );
}

/**
 * 画面が受け取る3値（B-22 設計 5章）。取得の結末に「読み込み中」を1つ足しただけのもので、
 * `failed` の中身は継ぎ目が畳んだままである（規則9）。
 */
export type PantryListState = { readonly outcome: 'loading' } | StockItemsOutcome;

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
   * 片方が起きた回にもう片方は起きない。
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
};

export function PantryList({
  stockItems,
  today,
  onDelete,
  onEdit,
  offline = false,
}: PantryListProps) {
  const [notice, setNotice] = useState<DeleteFailureNotice | null>(null);
  // 送っている間は次のスワイプを受け取らない。描き直す必要が無いので state にしない。
  const deleting = useRef(false);

  function deleteRow(id: string) {
    // 二重に送っても2度目は 404 になり、それを「すでに消えている」と読む（ADR-050）ので
    // 害は無いが、往復を1つ無駄にする。
    if (deleting.current) return;
    // **接続が切れている間は、削除と読めた動きを捨てる**（B-70 規則11）— スワイプは
    // `disabled` を持たない。断りの案内も出さない（理由は門の帯が既に示している）。
    // タップで編集を開くことは止めない（規則6）。
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
  if (stockItems.outcome === 'loading') return <p>{LOADING_NOTICE}</p>;
  if (stockItems.outcome === 'failed') return <p>{LOAD_FAILURE_NOTICE}</p>;

  const sections = pantrySectionsOf(stockItems.stockItems, today);

  // 在庫品が0件なら帯を1つも出さない（規則11）。
  if (sections.length === 0) return <p>{EMPTY_NOTICE}</p>;

  return (
    <div>
      {notice !== null && <p>{NOTICES[notice]}</p>}

      {sections.map((section) => (
        <section key={section.section}>
          <h2>{SECTION_HEADINGS[section.section]}</h2>
          <ul>
            {section.stockItems.map((row) => (
              <StockItemRow key={row.stockItem.id} row={row} onSwipe={deleteRow} onTap={onEdit} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
