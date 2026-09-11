/**
 * 画面の骨組みはこれから。構造は `docs/screen-design.md` に定めてある。
 * 下タブ3つ（献立 / 在庫 / 履歴）で、起動時にどれを開くかは判断待ち（同書 論点1）。
 *
 * **文言と配色は決まっていない**（同書 冒頭）。ここに書く日本語も仮である。
 */
import { features } from './features.js';
import { PantryList } from './features/pantry/PantryList.js';
import { todayOf } from './features/pantry/RemainingDays.js';

export function App() {
  // feature flag の分岐はここ1か所だけに置く（ADR-024 決定3 / B-11 設計 規則13）。
  // 読み出しは features.ts が持ち、画面の中でフラグを見ない（同 決定2）。
  //
  // 在庫品は当面0件を渡す。サーバからの取得はこの周では作らない（B-11 設計 2章）ので、
  // フラグを有効にしても出るのは0件の案内である。
  if (features.pantryList) {
    return (
      <main>
        <PantryList stockItems={[]} today={todayOf(new Date())} />
      </main>
    );
  }

  return <main>準備中</main>;
}
