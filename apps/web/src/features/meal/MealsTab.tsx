/**
 * 献立タブの**仮置き**（B-38 設計 2章）。`docs/screen-design.md` 第3章がここに来る。
 *
 * **中身はまだ無い。** 提案の経路がサーバに無く（`contexts/meal/api/` は `.gitkeep` のみ、
 * `main.ts` が結線しているルートは在庫の4経路だけ）、その背後の `MealGenerator` は
 * LLM プロバイダ待ちである（ADR-019）。S-4 / S-7 の見せ方もここに来る。
 *
 * **feature flag で隠さず、そのまま出す**（`CLAUDE.md` / `docs/workflow.md` 1章 / 同 規則7）。
 * 隠す仕組みを置くと、それ自体の保守が仕事になる。
 *
 * **文言は仮である**（`docs/screen-design.md` 冒頭・論点3）。
 */

export function MealsTab() {
  return <p>献立の提案はこれから作ります。</p>;
}
