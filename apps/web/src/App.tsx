/**
 * 画面の骨組みはこれから。構造は `docs/screen-design.md` に定めてある。
 * 下タブ3つ（献立 / 在庫 / 履歴）で、起動時にどれを開くかは判断待ち（同書 論点1）。
 *
 * **文言と配色は決まっていない**（同書 冒頭）。ここに書く日本語も仮である。
 */
import { PantryList } from './features/pantry/PantryList.js';
import { StockItemForm } from './features/pantry/StockItemForm.js';
import { todayOf } from './features/pantry/RemainingDays.js';

/**
 * 登録の実行。**サーバへ送る手段がまだ無いことを表して必ず断る**（B-12 設計 10章）。
 *
 * 解決させると、保存できていないのに保存できたように見える。偽の成功を出さないための形であり、
 * `POST /stock-items` を叩く層を置く B-24 まで続く（未完成は隠さない — CLAUDE.md）。
 */
function 登録を送る(): Promise<void> {
  return Promise.reject(new Error('在庫の登録をサーバへ送る経路はまだありません（B-24）'));
}

export function App() {
  // 在庫品は当面0件を渡す。サーバからの取得はまだ無い（B-22）ので、出るのは0件の案内である。
  // 遷移がまだ無いので、登録の画面は一覧の下に並べて置く（B-12 設計 10章）。
  return (
    <main>
      <PantryList stockItems={[]} today={todayOf(new Date())} />
      <StockItemForm onRegister={登録を送る} />
    </main>
  );
}
