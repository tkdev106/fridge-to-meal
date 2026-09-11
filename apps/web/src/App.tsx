/**
 * 画面の骨組みはこれから。構造は `docs/screen-design.md` に定めてある。
 * 下タブ3つ（献立 / 在庫 / 履歴）で、起動時にどれを開くかは判断待ち（同書 論点1）。
 *
 * **文言と配色は決まっていない**（同書 冒頭）。ここに書く日本語も仮である。
 */
import { PantryList } from './features/pantry/PantryList.js';
import { todayOf } from './features/pantry/RemainingDays.js';

export function App() {
  // 在庫品は当面0件を渡す。サーバからの取得はまだ無い（B-22）ので、出るのは0件の案内である。
  return (
    <main>
      <PantryList stockItems={[]} today={todayOf(new Date())} />
    </main>
  );
}
