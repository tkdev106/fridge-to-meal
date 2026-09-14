import { describe, expect, it } from 'vitest';
import type { SuggestionRepository } from '../../../../src/contexts/meal/domain/repository/SuggestionRepository.js';
import { createSuggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { createPantrySnapshot } from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
import { createSuggestionEntry } from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import { suggestionIdOf } from '../../../../src/contexts/meal/domain/value/SuggestionId.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { 記憶上の提案リポジトリ } from '../../../support/meal/InMemorySuggestionRepository.js';

const 我が家 = householdIdOf('11111111-1111-4111-8111-111111111111');
const 隣の家 = householdIdOf('99999999-9999-4999-8999-999999999999');

/** 提案の識別子。同点の決着は降順なので、小さい方と大きい方を置く（中は3件並べる回に使う）。 */
const 識別子小 = '55555555-5555-4555-8555-555555555555';
const 識別子中 = '66666666-6666-4666-8666-666666666666';
const 識別子大 = '77777777-7777-4777-8777-777777777777';

/**
 * 本題でない値を隠して提案を1件作る。本題は**識別子・世帯・生成日時**の3つだけで、
 * 並べた献立も在庫スナップショットも「最新の1件」の選び方には効かない。
 */
function 提案(props: { id: string; householdId?: HouseholdId; generatedAt?: string }) {
  return createSuggestion({
    id: suggestionIdOf(props.id),
    householdId: props.householdId ?? 我が家,
    entries: [
      createSuggestionEntry({
        mealId: mealIdOf('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        origin: 'reused',
      }),
    ],
    pantrySnapshot: createPantrySnapshot({ stockItems: [] }),
    generatedAt: dateTimeOf(props.generatedAt ?? '2026-09-13T12:00:00Z'),
  });
}

/** 先頭の引数の型を並べる。C-9 が全メソッドに世帯識別子を要求していることの検査に使う。 */
type 先頭の引数<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => unknown ? A[0] : never;
};

/**
 * 全メソッドの先頭が `HouseholdId` なら `true`、1つでも違えば `never`。
 * `never` になると下の代入が型検査で落ちる。
 */
type 全メソッドが世帯識別子を先頭に取るか =
  先頭の引数<SuggestionRepository>[keyof SuggestionRepository] extends HouseholdId ? true : never;

describe('提案リポジトリ SuggestionRepository', () => {
  it('全メソッドが世帯識別子を先頭の引数に取る（C-9）', () => {
    // 型の主張。世帯識別子を取らないメソッドを足した時点で、この行が typecheck で落ちる。
    // 実行時には何も確かめていない — 確かめているのは型検査のほうである。
    const 主張: 全メソッドが世帯識別子を先頭に取るか = true;

    expect(主張).toBe(true);
  });

  it('提案が1件も保存されていなければ、最新の提案は null になる', async () => {
    // B-28 5章 / 境界: まだ一度も提案していない世帯では、C-7 の比べる相手が無い。
    const repository: SuggestionRepository = new 記憶上の提案リポジトリ();

    expect(await repository.findLatestByHousehold(我が家)).toBeNull();
  });

  it('最新の提案は、生成日時が新しいほうを返す', async () => {
    // ADR-038 決定1 / B-28 7章3行目: 順序を約束しない「1件」は意味を持たない。
    // **新しい方を先に保存し、識別子も小さくしてある** — 保存の順や識別子だけで
    // 決めている実装なら古い方が返る。
    const repository: SuggestionRepository = new 記憶上の提案リポジトリ();
    await repository.save(我が家, 提案({ id: 識別子小, generatedAt: '2026-09-13T12:00:00Z' }));
    await repository.save(我が家, 提案({ id: 識別子大, generatedAt: '2026-09-12T12:00:00Z' }));

    const 取得 = await repository.findLatestByHousehold(我が家);

    expect(取得?.id).toBe(識別子小);
  });

  it('生成日時が同じときは、提案の識別子の降順で先のものを返す', async () => {
    // ADR-038 決定2 / C-12: 同点を閉じないと、同じ日に2回提案した世帯で比べる相手が
    // 実行ごとに変わる。**識別子の小さい方を先に保存してある** — 保存の順で決めている
    // 実装なら小さい方が返る。
    const repository: SuggestionRepository = new 記憶上の提案リポジトリ();
    await repository.save(我が家, 提案({ id: 識別子小, generatedAt: '2026-09-13T12:00:00Z' }));
    await repository.save(我が家, 提案({ id: 識別子大, generatedAt: '2026-09-13T12:00:00Z' }));

    const 取得 = await repository.findLatestByHousehold(我が家);

    expect(取得?.id).toBe(識別子大);
  });

  it('最新の1件は、直近の提案の先頭と同じものになる', async () => {
    // ADR-038 決定1・2 / 結果2 / B-28 5章: C-7 が見る「最新の1件」と C-11 が見る
    // 「直近3回の先頭」は同じ提案でなければならない。片方の順序だけが動くと、両方の口が
    // それぞれの約束を守ったまま**別の提案を指す。**
    //
    // **同点を1組含めてあるのが要点である** — 生成日時だけがばらけた組では、識別子の降順で
    // 閉じる部分（決定2）が揃っているかを確かめられない。保存の順は生成日時の順と
    // わざと違えてある。
    const repository: SuggestionRepository = new 記憶上の提案リポジトリ();
    await repository.save(我が家, 提案({ id: 識別子小, generatedAt: '2026-09-13T12:00:00Z' }));
    await repository.save(我が家, 提案({ id: 識別子中, generatedAt: '2026-09-12T12:00:00Z' }));
    await repository.save(我が家, 提案({ id: 識別子大, generatedAt: '2026-09-13T12:00:00Z' }));

    const 最新の1件 = await repository.findLatestByHousehold(我が家);
    const 直近の提案 = await repository.findRecentByHousehold(我が家, 3);

    // 既定値を左右でずらす。両方とも「無い」ときに緑にならないようにするためである。
    expect(最新の1件?.id ?? '最新の1件が無い').toBe(直近の提案[0]?.id ?? '直近の提案が0件である');
  });

  it('別の世帯の提案は、最新の提案として返さない', async () => {
    // C-9 の核心。世帯をまたぐ取得が起きないことを、実装ごとにここで確かめられる。
    const repository: SuggestionRepository = new 記憶上の提案リポジトリ();
    await repository.save(隣の家, 提案({ id: 識別子小, householdId: 隣の家 }));

    expect(await repository.findLatestByHousehold(我が家)).toBeNull();
  });
});
