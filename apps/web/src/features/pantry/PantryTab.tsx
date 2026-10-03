/**
 * 在庫タブの中身（B-39 設計 4章 / 5章）。一覧（`PantryList`）と登録（`StockItemForm`）の
 * **出し分け**と、いまどちらを出しているかの状態を持つ場所である（同 6章 規則1〜4）。
 *
 * **一覧の側は常に木に置く**（B-65b 設計 規則1〜3。B-39 規則1「出すのは一方だけ」と B-55 規則16
 * 「入れ替わる」はここで置き換わった）。登録・編集は開いている間だけ一覧の側の後ろにパネルとして
 * 置き、その間は一覧の側の全体を `inert` にする。SP では CSS が一覧の側を隠して入れ替わりに見せ、
 * PC（幅 1024px 以上）では右から幅 440px のパネルとして並べる（ADR-076 決定2 — 幅を JS で読まない）。
 * パネルは閉じれば木から外れるので、打ちかけの入力は残らない（B-39 規則7）。**閉じたら焦点を
 * 開いた操作へ戻す**（登録は `食材を追加`、編集はその行の `…`。B-65b 規則7）。
 *
 * 編集は一覧の行のタップか行末の `…` の `編集` から開き、**通った回と保存せずに閉じた回に閉じる**
 * （B-55 設計 規則8）。
 *
 * **状態を持つのはここである**（規則4）。器（`navigation/TabbedScreen.tsx`）にも門
 * （`App.tsx`）にも持たせない — 門が持てば「在庫を取りに行く効果」と同じ場所に画面の遷移が
 * 混ざり、器が持てば器が中身の中身を知ることになる。門が一覧を取り直しても（B-22 設計 規則10 /
 * B-24 / B-23）、開いている登録の画面は閉じない。
 *
 * **下タブの帯は登録の画面でも出したままである**（規則5 / NFR-14）。隠すには器か門が
 * 「在庫タブが下位の画面に居る」ことを知る必要があり、規則4 と衝突する。パネルの間の `inert` も
 * 帯には及ばない（B-65b 規則4）。
 *
 * サーバへの口はすべて門から受け取って素通しする（規則17 / ADR-046 決定3）— この画面は
 * セッションも `fetch` も基点も知らない。ログアウトも知らない — ログアウトは設定画面にあり、
 * 在庫タブには置かない（B-56c 規則12 / `docs/screen-design.md` 2.1）。
 *
 * **日本語はここには一覧の見出し `冷蔵庫` と登録を開く操作の名前だけを置く**（規則15 /
 * B-64 設計 規則1・2）。欄のラベル・保存・「←」・案内は `StockItemForm.tsx` の持ち分である。
 *
 * **見た目の値は `PantryTab.module.css` にだけ置く**（ADR-055 決定1 / B-64 設計 規則12）。
 */

import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { StockItemDto } from '@fridge-to-meal/contract';
import type { IngredientNamesState } from './IngredientNameOptions.js';
import { PantryList } from './PantryList.js';
import type { FocusOperationsRequest, PantryListState } from './PantryList.js';
import { StockItemEditForm } from './StockItemEditForm.js';
import { StockItemForm } from './StockItemForm.js';
import styles from './PantryTab.module.css';
import { Icon } from '../../icons/Icon.js';
import type {
  DeleteStockItem,
  RegisterStockItem,
  UpdateStockItem,
} from '../../server/StockItemRequests.js';
import { ScreenHeader } from '../../navigation/ScreenHeader.js';

/**
 * 一覧の見出し（原本 `PantryScreen.dc.html` / B-60 規則13 / B-64 規則1）。文言はデザインが正である
 * （ADR-074 決定1）。
 */
const HEADING = '冷蔵庫';

/**
 * 登録を開く操作の名前（B-64 設計 規則2）。見えるのは `plus` のアイコンだけで、名前は
 * `aria-label` のこの文だけが運ぶ（アイコンは `aria-hidden`）。
 */
const OPEN_REGISTER_LABEL = '食材を追加';

/**
 * パネルを閉じた回の焦点の戻し先（B-65b 設計 規則7）。登録は `食材を追加`、編集はその行の `…`。
 */
type FocusReturn =
  { readonly kind: 'openRegister' } | ({ readonly kind: 'operations' } & FocusOperationsRequest);

export type PantryTabProps = {
  /** 在庫一覧の3値。**門から素通しで受け取る**（B-22 設計 規則10 / B-39 設計 規則4）。 */
  stockItems: PantryListState;
  /**
   * 残日数を数える基準日（`YYYY-MM-DD`）。**ここで `new Date()` を読まない**
   * （`docs/testing.md` 5章）— 実行環境の暦日を作るのは門の仕事である。
   */
  today: string;
  /** 削除の実行（B-23）。一覧へ素通しする。 */
  onDelete: DeleteStockItem;
  /** 登録の実行（B-24）。登録の画面へ素通しする。 */
  onRegister: RegisterStockItem;
  /**
   * 更新の実行（FR-05 / B-55 設計 5章）。編集の画面へ素通しする。
   *
   * **この画面は結末を読まない** — 断りから案内を選ぶのも、通った回に閉じるのも
   * `StockItemEditForm` の側である（ADR-032 決定3 / B-55 設計 規則8）。
   */
  onUpdate: UpdateStockItem;
  /**
   * 補完の元になる食材名の3値（FR-02 / B-50c）。**登録の画面へ素通しする** — 一覧では
   * 使わず、この画面は中身も読まない（読むのは `StockItemForm` の側である）。
   */
  ingredientNames: IngredientNamesState;
  /** 接続が切れているか（B-70 / FR-41）。省略は `false`。 */
  offline?: boolean;
  /** 見出しの行の歯車が押された（B-60 設計 6章 規則12）。設定を開いているかは門が持つ。 */
  onOpenSettings: () => void;
};

export function PantryTab({
  stockItems,
  today,
  onDelete,
  onRegister,
  onUpdate,
  ingredientNames,
  offline = false,
  onOpenSettings,
}: PantryTabProps): JSX.Element {
  // `offline`（B-70）はこの画面では読まず、書き込みを持つ3つの画面へ素通しする。
  // 開いた直後は一覧である（規則2 / 要件 第7章）。
  const [registering, setRegistering] = useState(false);
  // 編集している在庫品1件（null なら編集していない。B-55 設計 規則16・17）。**行から
  // 受け取った1件をそのまま持つ** — 識別子だけを持って一覧から引き直すと、門が一覧を
  // 取り直した回に対象が入れ替わる（同 規則17）。
  const [editing, setEditing] = useState<StockItemDto | null>(null);
  // パネルを閉じた回に焦点を戻す先（B-65b 設計 規則7）。**閉じるたびに新しい値を作る** — 同じ
  // 戻し先が2度続いても、参照が変わるので2度目も移る（10章 前提5）。
  const [focusReturn, setFocusReturn] = useState<FocusReturn | null>(null);
  const openRegisterButton = useRef<HTMLButtonElement>(null);

  // 焦点は描いたあとに移す — 閉じた同じ描画で一覧の側の `inert` が外れており、`inert` の中の
  // 要素には焦点が乗らないため（規則7）。行の `…` は一覧の側が受け持つ（`focusOperationsRequest`）。
  useEffect(() => {
    if (focusReturn?.kind === 'openRegister') openRegisterButton.current?.focus();
  }, [focusReturn]);

  function closeRegister() {
    setRegistering(false);
    setFocusReturn({ kind: 'openRegister' });
  }

  function closeEdit(stockItem: StockItemDto) {
    setEditing(null);
    setFocusReturn({ kind: 'operations', stockItemId: stockItem.id });
  }

  // 登録と編集が同時に出ることはない（編集は一覧の行からしか開かず、開いている間の一覧は `inert`）。
  // 閉じたときに木から外れるので、打ちかけの入力はそのまま捨てられる（B-39 規則7）— 下書きを
  // ここで抱えない。編集に **`key` を置かない**のも同じ理由で、別の行を開いた回の欄の値は mount の
  // たびに作り直される（B-55 規則2・17）。
  const panel = registering ? (
    <StockItemForm
      onRegister={onRegister}
      onClose={closeRegister}
      ingredientNames={ingredientNames}
      offline={offline}
    />
  ) : editing !== null ? (
    <StockItemEditForm
      stockItem={editing}
      onUpdate={onUpdate}
      onClose={() => closeEdit(editing)}
      offline={offline}
      today={today}
    />
  ) : null;
  const panelOpen = panel !== null;

  // **一覧の側は常に木に置き、パネルはその後ろに置く**（B-65b 設計 規則1・2）。パネルを出している
  // 間は一覧の側の全体（見出しの行を含む）を `inert` にする — **幅で変えない**（規則3 / ADR-076
  // 結果2）。SP で一覧の側を隠して入れ替わりに見せるのは CSS である（規則11）。パネルの包みには
  // 役割を付けない（規則5 — SP では画面そのものであり、幅で ARIA を変えられない）。
  return (
    <div className={styles.tab}>
      <div
        className={`${styles.screen} ${panelOpen ? styles.screenBehindPanel : ''}`}
        inert={panelOpen}
      >
        <div className={styles.header}>
          <ScreenHeader
            title={HEADING}
            onOpenSettings={onOpenSettings}
            actions={
              <button
                ref={openRegisterButton}
                type="button"
                className={styles.iconButton}
                aria-label={OPEN_REGISTER_LABEL}
                onClick={() => setRegistering(true)}
              >
                <Icon name="plus" size={24} />
              </button>
            }
          />
        </div>

        {/* 行のタップで編集へ移る（B-55 設計 規則15・16 / `docs/screen-design.md` 2章
            `pantry --> edit`）。**どの動きをタップと読むかは一覧の側の判断である**
            （`SwipeGesture.ts`）— ここは受け取った1件を持つだけである。 */}
        <PantryList
          stockItems={stockItems}
          today={today}
          onDelete={onDelete}
          onEdit={setEditing}
          offline={offline}
          focusOperationsRequest={focusReturn?.kind === 'operations' ? focusReturn : null}
        />
      </div>

      {panel !== null && <div className={styles.formPanel}>{panel}</div>}
    </div>
  );
}
