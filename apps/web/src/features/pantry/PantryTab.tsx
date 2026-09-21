/**
 * 在庫タブの中身（B-39 設計 4章 / 5章）。一覧（`PantryList`）と登録（`StockItemForm`）の
 * **出し分け**と、いまどちらを出しているかの状態を持つ場所である（同 6章 規則1〜4）。
 *
 * **出すのは一方だけである**（規則1）。`hidden` で隠して両方置くのではなく、出していない側は
 * そもそも木に置かない — `TabbedScreen` が選んでいないタブの中身を置かないのと同じ構えであり、
 * 閉じたときに打ちかけの入力が残らないのもこの置き方の帰結である（規則7）。
 *
 * **状態を持つのはここである**（規則4）。器（`navigation/TabbedScreen.tsx`）にも門
 * （`App.tsx`）にも持たせない — 門が持てば「在庫を取りに行く効果」と同じ場所に画面の遷移が
 * 混ざり、器が持てば器が中身の中身を知ることになる。門が一覧を取り直しても（B-22 設計 規則10 /
 * B-24 / B-23）、開いている登録の画面は閉じない。
 *
 * **下タブの帯は登録の画面でも出したままである**（規則5 / NFR-14）。隠すには器か門が
 * 「在庫タブが下位の画面に居る」ことを知る必要があり、規則4 と衝突する。
 *
 * サーバへの口はすべて門から受け取って素通しする（規則17 / ADR-046 決定3）— この画面は
 * セッションも `fetch` も基点も知らない。ログアウトも知らない（規則16 / ADR-046 結果4）。
 *
 * **日本語はここには登録を開く操作の名札だけを置く**（規則15）。見出し・欄のラベル・保存・
 * 「←」・案内は `StockItemForm.tsx` の持ち分である。
 */

import type { JSX } from 'react';
import { useState } from 'react';
import { PantryList } from './PantryList.js';
import type { PantryListState } from './PantryList.js';
import { StockItemForm } from './StockItemForm.js';
import type { DeleteStockItem, RegisterStockItem } from '../../server/StockItemRequests.js';

/**
 * 登録を開く操作の名札。**仮の文言である**（`docs/screen-design.md` 論点3 / 規則15）—
 * 同書 5章のワイヤーは見出しの行の右端に「＋」を置いており、記号だけでは読み上げに乗らない
 * ため、いまは文字を添えてある。
 */
const OPEN_REGISTER_LABEL = '＋ 食材を追加';

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
};

export function PantryTab({
  stockItems,
  today,
  onDelete,
  onRegister,
}: PantryTabProps): JSX.Element {
  // 開いた直後は一覧である（規則2 / 要件 第7章）。
  const [registering, setRegistering] = useState(false);

  // 登録の画面は一覧と**入れ替わる**（規則1）。閉じたときに木から外れるので、打ちかけの入力は
  // そのまま捨てられる（規則7）— 下書きをここで抱えない。
  if (registering) {
    return <StockItemForm onRegister={onRegister} onClose={() => setRegistering(false)} />;
  }

  // 登録を開く操作は一覧より前に置く（規則3。`docs/screen-design.md` 5章の見出しの行の右端）。
  // **一覧が取れなかった回も置いたままにする** — 取得の断りは登録に及ばない（7章）。
  return (
    <>
      <button type="button" onClick={() => setRegistering(true)}>
        {OPEN_REGISTER_LABEL}
      </button>

      <PantryList stockItems={stockItems} today={today} onDelete={onDelete} />
    </>
  );
}
