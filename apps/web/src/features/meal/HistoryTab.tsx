/**
 * 履歴タブの**仮置き**（B-38 設計 2章）。`docs/screen-design.md` 第7章がここに来る。
 *
 * **中身はまだ無い。** 出すのは調理記録（`CookingRecord`）であり、その経路もサーバに無い。
 * 同書 2.1 が言う「設定は履歴タブの右上」もまだ作らない — ログアウトは在庫タブの下に
 * 置いたままである（ADR-046 結果4 の暫定）。
 *
 * **feature flag で隠さず、そのまま出す**（`CLAUDE.md` / `docs/workflow.md` 1章 / 同 規則7）。
 *
 * **文言は仮である**（`docs/screen-design.md` 冒頭・論点3）。
 */

export function HistoryTab() {
  return <p>作った献立の履歴はこれから作ります。</p>;
}
