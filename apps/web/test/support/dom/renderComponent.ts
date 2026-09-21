/**
 * コンポーネントを描いて観察するための継ぎ目（`docs/testing.md` 4章 / ADR-052）。
 *
 * **このモジュールを import するテストは、ファイルの先頭で jsdom を宣言すること。**
 * 既定の環境は node のままである（同 5章 — 多数派のテストに jsdom の起動を負わせない）。
 *
 * ```ts
 * // @vitest-environment jsdom
 * ```
 *
 * **テストから触ってよいのはここが再輸出するものだけ**にしておく。`@testing-library/*` を
 * 直に import すると、後始末の登録を忘れた回に**前のテストが描いたものが次のテストに残る** —
 * 残った木は見つかりはするので、赤くならずに**嘘の緑**になる。
 *
 * **問い合わせは利用者から見える手がかりで書く**（役割・文言・ラベル）。`querySelector` で
 * class や DOM の形を辿らない — それは実装詳細であり、`docs/testing.md` 3章 が禁じている
 * 「壊れていないのに赤くなるテスト」をそのまま作る。
 */

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// 1件ごとに描いたものを片付ける。**`globals` を有効にしていない**ため自動では登録されず、
// ここで1度だけ登録する（import した時点で、そのテストファイルに効く）。
afterEach(cleanup);

// **押す手段もここから出す。** 素の `element.click()` は React 19 の更新を `act` の外で
// 起こし、警告と一緒に「描き直されていない木」をテストに見せる。`fireEvent` は
// `@testing-library/react` が `act` で包んだものである。
// **`@testing-library/user-event` は入れない** — 依存の追加は止まる条件である（`CLAUDE.md`）。
// **待つ手段もここから出す。** 結末が非同期に届く操作（登録を送る等）では、押した直後の木は
// まだ更新されていない。`waitFor` は `act` の中で待つため、**待っている間に届いた更新まで
// 画面へ反映される** — 素の `await Promise.resolve()` では警告と一緒に古い木を見せる。
// **待つ条件に仮の文言を使わない**（`docs/testing.md` 4.1）。テストが渡したデータで書く。
export { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
