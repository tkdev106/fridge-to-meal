import { describe, expect, it } from 'vitest';
import type { SuggestionRepository } from '../../../../src/contexts/meal/domain/repository/SuggestionRepository.js';
import { MealRuleViolation } from '../../../../src/contexts/meal/domain/error/MealRuleViolation.js';
import { createSuggestion } from '../../../../src/contexts/meal/domain/entity/Suggestion.js';
import { createPantrySnapshot } from '../../../../src/contexts/meal/domain/value/PantrySnapshot.js';
import type { SuggestionEntryOrigin } from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import { createSuggestionEntry } from '../../../../src/contexts/meal/domain/value/SuggestionEntry.js';
import { suggestionIdOf } from '../../../../src/contexts/meal/domain/value/SuggestionId.js';
import { dateTimeOf } from '../../../../src/contexts/meal/domain/value/DateTime.js';
import { mealIdOf } from '../../../../src/contexts/meal/domain/value/MealId.js';
import type { HouseholdId } from '../../../../src/shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import { InMemorySuggestionRepository } from '../../../support/meal/InMemorySuggestionRepository.js';

const ourHousehold = householdIdOf('11111111-1111-4111-8111-111111111111');
const neighborHousehold = householdIdOf('99999999-9999-4999-8999-999999999999');

/** 提案の識別子。同点の決着は降順なので、小さい方と大きい方を置く（中は3件並べる回に使う）。 */
const smallId = '55555555-5555-4555-8555-555555555555';
const middleId = '66666666-6666-4666-8666-666666666666';
const largeId = '77777777-7777-4777-8777-777777777777';

/**
 * 本題でない値を隠して提案を1件作る。本題は**識別子・世帯・生成日時**の3つだけで、
 * 並べた献立も在庫スナップショットも「最新の1件」の選び方には効かない。
 *
 * **由来だけは数える口の本題である**（ADR-049 決定1）。既定は再利用のままにしてある —
 * 数えるのは生成の由来を持つ提案だけであり、既定を生成にすると数えない側の回が書きにくい。
 */
function suggestion(props: {
  id: string;
  householdId?: HouseholdId;
  generatedAt?: string;
  origin?: SuggestionEntryOrigin;
}) {
  return createSuggestion({
    id: suggestionIdOf(props.id),
    householdId: props.householdId ?? ourHousehold,
    entries: [
      createSuggestionEntry({
        mealId: mealIdOf('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        origin: props.origin ?? 'reused',
      }),
    ],
    pantrySnapshot: createPantrySnapshot({ stockItems: [] }),
    generatedAt: dateTimeOf(props.generatedAt ?? '2026-09-13T12:00:00Z'),
  });
}

/** 数える窓の下端。下の回はこれを境に入る側と出る側を1分ずつ跨がせてある（ADR-049 決定2）。 */
const windowStart = dateTimeOf('2026-09-13T12:00:00Z');

/** 先頭の引数の型を並べる。C-9 が全メソッドに世帯識別子を要求していることの検査に使う。 */
type FirstParameter<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => unknown ? A[0] : never;
};

/**
 * 全メソッドの先頭が `HouseholdId` なら `true`、1つでも違えば `never`。
 * `never` になると下の代入が型検査で落ちる。
 */
type AllMethodsTakeHouseholdIdFirst =
  FirstParameter<SuggestionRepository>[keyof SuggestionRepository] extends HouseholdId
    ? true
    : never;

describe('提案リポジトリ SuggestionRepository', () => {
  it('全メソッドが世帯識別子を先頭の引数に取る（C-9）', () => {
    // 型の主張。世帯識別子を取らないメソッドを足した時点で、この行が typecheck で落ちる。
    // 実行時には何も確かめていない — 確かめているのは型検査のほうである。
    const assertion: AllMethodsTakeHouseholdIdFirst = true;

    expect(assertion).toBe(true);
  });

  it('提案が1件も保存されていなければ、最新の提案は null になる', async () => {
    // B-28 5章 / 境界: まだ一度も提案していない世帯では、C-7 の比べる相手が無い。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();

    expect(await repository.findLatestByHousehold(ourHousehold)).toBeNull();
  });

  it('最新の提案は、生成日時が新しいほうを返す', async () => {
    // ADR-038 決定1 / B-28 7章3行目: 順序を約束しない「1件」は意味を持たない。
    // **新しい方を先に保存し、識別子も小さくしてある** — 保存の順や識別子だけで
    // 決めている実装なら古い方が返る。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      ourHousehold,
      suggestion({ id: smallId, generatedAt: '2026-09-13T12:00:00Z' }),
    );
    await repository.save(
      ourHousehold,
      suggestion({ id: largeId, generatedAt: '2026-09-12T12:00:00Z' }),
    );

    const found = await repository.findLatestByHousehold(ourHousehold);

    expect(found?.id).toBe(smallId);
  });

  it('生成日時が同じときは、提案の識別子の降順で先のものを返す', async () => {
    // ADR-038 決定2 / C-12: 同点を閉じないと、同じ日に2回提案した世帯で比べる相手が
    // 実行ごとに変わる。**識別子の小さい方を先に保存してある** — 保存の順で決めている
    // 実装なら小さい方が返る。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      ourHousehold,
      suggestion({ id: smallId, generatedAt: '2026-09-13T12:00:00Z' }),
    );
    await repository.save(
      ourHousehold,
      suggestion({ id: largeId, generatedAt: '2026-09-13T12:00:00Z' }),
    );

    const found = await repository.findLatestByHousehold(ourHousehold);

    expect(found?.id).toBe(largeId);
  });

  it('最新の1件は、直近の提案の先頭と同じものになる', async () => {
    // ADR-038 決定1・2 / 結果2 / B-28 5章: C-7 が見る「最新の1件」と C-11 が見る
    // 「直近3回の先頭」は同じ提案でなければならない。片方の順序だけが動くと、両方の口が
    // それぞれの約束を守ったまま**別の提案を指す。**
    //
    // **同点を1組含めてあるのが要点である** — 生成日時だけがばらけた組では、識別子の降順で
    // 閉じる部分（決定2）が揃っているかを確かめられない。保存の順は生成日時の順と
    // わざと違えてある。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      ourHousehold,
      suggestion({ id: smallId, generatedAt: '2026-09-13T12:00:00Z' }),
    );
    await repository.save(
      ourHousehold,
      suggestion({ id: middleId, generatedAt: '2026-09-12T12:00:00Z' }),
    );
    await repository.save(
      ourHousehold,
      suggestion({ id: largeId, generatedAt: '2026-09-13T12:00:00Z' }),
    );

    const latest = await repository.findLatestByHousehold(ourHousehold);
    const recentSuggestions = await repository.findRecentByHousehold(ourHousehold, 3);

    // 既定値を左右でずらす。両方とも「無い」ときに緑にならないようにするためである。
    expect(latest?.id ?? '最新の1件が無い').toBe(
      recentSuggestions[0]?.id ?? '直近の提案が0件である',
    );
  });

  it('別の世帯の提案は、最新の提案として返さない', async () => {
    // C-9 の核心。世帯をまたぐ取得が起きないことを、実装ごとにここで確かめられる。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      neighborHousehold,
      suggestion({ id: smallId, householdId: neighborHousehold }),
    );

    expect(await repository.findLatestByHousehold(ourHousehold)).toBeNull();
  });

  // ここから生成の回数を数える口（ADR-049 決定1 / NFR-C2）。**interface では強制できない
  // 約束がもう1つ増える**（同 結果4 / ADR-038 結果2）。数える条件は**世帯・由来・窓の下端の
  // 境界**の3つで、どれが緩んでも上限が実装ごとに変わる。

  it('提案が1件も保存されていなければ、生成の回数は0になる', async () => {
    // ADR-049 決定1 / 境界: 一度も提案していない世帯では数える相手が無い。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();

    expect(await repository.countGeneratedByHouseholdSince(ourHousehold, windowStart)).toBe(0);
  });

  it('生成の由来を持つ提案を、窓の内側で数える', async () => {
    // ADR-049 決定1 / NFR-C2: 数えるのは生成を呼んだ回数である。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      ourHousehold,
      suggestion({ id: smallId, origin: 'generated', generatedAt: '2026-09-13T13:00:00Z' }),
    );
    await repository.save(
      ourHousehold,
      suggestion({ id: largeId, origin: 'generated', generatedAt: '2026-09-13T14:00:00Z' }),
    );

    expect(await repository.countGeneratedByHouseholdSince(ourHousehold, windowStart)).toBe(2);
  });

  it('再利用の由来の提案は、生成の回数に入れない', async () => {
    // ADR-049 決定1 / C-14: 再利用だけで組めた提案も保存されるので、保存された提案を
    // そのまま数えると**呼んでいない回まで上限を食う。**
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      ourHousehold,
      suggestion({ id: smallId, origin: 'reused', generatedAt: '2026-09-13T13:00:00Z' }),
    );

    expect(await repository.countGeneratedByHouseholdSince(ourHousehold, windowStart)).toBe(0);
  });

  it('窓の下端より前の提案は、生成の回数に入れない', async () => {
    // ADR-049 決定2: 窓の外は数えない。24時間を過ぎた回は1回ぶん戻る。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      ourHousehold,
      suggestion({ id: smallId, origin: 'generated', generatedAt: '2026-09-13T11:59:00Z' }),
    );

    expect(await repository.countGeneratedByHouseholdSince(ourHousehold, windowStart)).toBe(0);
  });

  it('窓の下端ちょうどの提案は、生成の回数に入れる', async () => {
    // ADR-049 決定2（境界の閉じ方）: 下端は含む。**どちらに倒すかを約束しないと、
    // ちょうど24時間前に呼んだ回が実装ごとに数えられたり数えられなかったりする。**
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      ourHousehold,
      suggestion({ id: smallId, origin: 'generated', generatedAt: '2026-09-13T12:00:00Z' }),
    );

    expect(await repository.countGeneratedByHouseholdSince(ourHousehold, windowStart)).toBe(1);
  });

  it('別の世帯の生成は、生成の回数に入れない', async () => {
    // C-9 / ADR-049 決定1: 数える単位は世帯である。隣の世帯の生成でこちらが締め出されない。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      neighborHousehold,
      suggestion({
        id: smallId,
        householdId: neighborHousehold,
        origin: 'generated',
        generatedAt: '2026-09-13T13:00:00Z',
      }),
    );

    expect(await repository.countGeneratedByHouseholdSince(ourHousehold, windowStart)).toBe(0);
  });

  // ここから同じ識別子の2度目の保存（B-57 規則1〜3 / ADR-058 決定1）。本物は主キーが
  // 表全体で一意なので、世帯を問わず2度目を DB が拒む。差し替えも同じ場所で拒まないと、
  // 単体テストの上だけで「同じ提案を2度積める」が通る。

  it('同じ提案を2度 save すると、2度目を拒む', async () => {
    // B-57 規則2・3 / ADR-058 決定1: 同じ識別子の2度目は拒む。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(ourHousehold, suggestion({ id: smallId }));

    const execution = repository.save(ourHousehold, suggestion({ id: smallId }));

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.duplicateId' });
  });

  it('同じ識別子で中身の違う提案を save しても、2度目を拒む', async () => {
    // B-57 規則3 / ADR-058 比較した案 1-B: 中身を読み比べてべき等に通す経路は持たない。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      ourHousehold,
      suggestion({ id: smallId, generatedAt: '2026-09-13T12:00:00Z', origin: 'reused' }),
    );

    const execution = repository.save(
      ourHousehold,
      suggestion({ id: smallId, generatedAt: '2026-09-13T13:00:00Z', origin: 'generated' }),
    );

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.duplicateId' });
  });

  it('拒んだ2度目の提案は、直近の提案に現れない', async () => {
    // B-57 規則2: 拒んだ回は何も積まない。残るのは1回目の提案だけである。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      ourHousehold,
      suggestion({ id: smallId, generatedAt: '2026-09-13T12:00:00Z' }),
    );
    // 拒むこと自体は上の行が確かめる。ここで見るのは拒んだ後に残るものだけである。
    await repository
      .save(ourHousehold, suggestion({ id: smallId, generatedAt: '2026-09-13T13:00:00Z' }))
      .catch(() => undefined);

    const recentSuggestions = await repository.findRecentByHousehold(ourHousehold, 10);

    expect(recentSuggestions.map((found) => found.generatedAt)).toEqual([
      '2026-09-13T12:00:00.000Z',
    ]);
  });

  it('別の世帯が保存した提案と識別子が同じなら、こちらの世帯の save も拒む', async () => {
    // B-57 規則2 / ADR-058 決定1 / C-9: 主キーは世帯をまたいで一意である。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      neighborHousehold,
      suggestion({ id: smallId, householdId: neighborHousehold }),
    );

    const execution = repository.save(ourHousehold, suggestion({ id: smallId }));

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.duplicateId' });
  });

  it('別の世帯の提案と識別子が衝突して拒んだ回は、こちらの世帯に提案を積まない', async () => {
    // B-57 規則2 / C-9: 衝突で拒んだ提案が、こちらの世帯の最新の提案として現れない。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(
      neighborHousehold,
      suggestion({ id: smallId, householdId: neighborHousehold }),
    );
    // 拒むこと自体は上の行が確かめる。ここで見るのは拒んだ後に残るものだけである。
    await repository.save(ourHousehold, suggestion({ id: smallId })).catch(() => undefined);

    expect(await repository.findLatestByHousehold(ourHousehold)).toBeNull();
  });

  it('識別子が保存済みで世帯も食い違う save は、世帯の食い違いとして拒む', async () => {
    // B-57 規則1 / C-9: 世帯の食い違いを先に見る。識別子の重複より世帯分離の断りが優先する。
    const repository: SuggestionRepository = new InMemorySuggestionRepository();
    await repository.save(ourHousehold, suggestion({ id: smallId }));

    const execution = repository.save(
      neighborHousehold,
      suggestion({ id: smallId, householdId: ourHousehold }),
    );

    await expect(execution).rejects.toThrow(MealRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'save.householdMismatch' });
  });
});
