/**
 * 補完に出す名称を結末から読む判断（B-50c 設計 規則3 / 5章。先行 `DeleteFailureNotice.test.ts`）。
 *
 * **取れなかったことと補完が無いことは、画面では同じである** — その読みをここに1つだけ置く。
 */

import { describe, expect, it } from 'vitest';
import { ingredientNameOptionsOf } from '../../../src/features/pantry/IngredientNameOptions.js';

describe('補完に出す名称を選ぶ ingredientNameOptionsOf', () => {
  it('取れた名称はそのまま補完に出す', () => {
    // 並べ替えない — 並びを決めるのはサーバである（ADR-063 決定4）。
    expect(
      ingredientNameOptionsOf({ outcome: 'loaded', ingredientNames: ['にんじん', '豚こま肉'] }),
    ).toEqual(['にんじん', '豚こま肉']);
  });

  it('取れなかった回は補完を出さない', () => {
    // **登録は止めない**（FR-02 / FR-03）。案内も出さず、補完だけが無い。
    expect(ingredientNameOptionsOf({ outcome: 'failed' })).toEqual([]);
  });

  it('まだ取れていない間も補完を出さない', () => {
    // 取りに行っている間に開いた登録の画面でも、欄はそのまま使える。
    expect(ingredientNameOptionsOf({ outcome: 'loading' })).toEqual([]);
  });
});
