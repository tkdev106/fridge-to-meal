import { describe, expect, it } from 'vitest';
import type {
  ListStockItemsOutput,
  RegisterStockItemInput,
  StockItemDto,
  UpdateStockItemInput,
} from '@fridge-to-meal/contract';

// 契約は型だけを持ち、実行時の分岐を持たない（設計書 7章）。したがってここで確かめるのは
// 「契約に沿う値が組み立てられること」と「契約に反する値が型として通らないこと」である。
// 後者は @ts-expect-error で押さえ、pnpm typecheck が赤を出す。

const stockItemId = '22222222-2222-4222-8222-222222222222';
const anotherStockItemId = '44444444-4444-4444-8444-444444444444';
const ingredientId = '33333333-3333-4333-8333-333333333333';

/** 一覧に並べる在庫品を作る。本題でない値をここに隠す。 */
function stockItemDto(id: string, name: string, expiryDate: string | null): StockItemDto {
  return { id, name, ingredientId: null, amount: null, expiryDate, useForMeals: true };
}

describe('在庫品の表現 StockItemDto', () => {
  it('在庫品は識別子・名称・食材・分量・期限・献立に使うかどうかを持つ', () => {
    // FR-04 / FR-43: 一覧に出すのに要る6つ（設計書 5章）。
    const dto: StockItemDto = {
      id: stockItemId,
      name: 'にんじん',
      ingredientId: ingredientId,
      amount: '2本',
      expiryDate: '2026-09-30',
      useForMeals: false,
    };

    expect(dto.name).toBe('にんじん');
    expect(dto.amount).toBe('2本');
    expect(dto.expiryDate).toBe('2026-09-30');
    expect(dto.useForMeals).toBe(false);
  });

  it('カタログにない食材・分量なし・期限なしを null で表せる', () => {
    // FR-03 / FR-13 / 規則3: 「無し」は null で表す。
    const dto: StockItemDto = {
      id: stockItemId,
      name: '母のぬか床',
      ingredientId: null,
      amount: null,
      expiryDate: null,
      useForMeals: true,
    };

    expect(dto.ingredientId).toBeNull();
    expect(dto.amount).toBeNull();
    expect(dto.expiryDate).toBeNull();
  });

  it('返す在庫品では期限のキーを省略できない', () => {
    // 規則3: キーの省略を許すのは登録の入力だけ。返す側は必ず null を載せる。
    // @ts-expect-error 期限のキーが無い値は在庫品の表現ではない
    const dto: StockItemDto = {
      id: stockItemId,
      name: 'にんじん',
      ingredientId: null,
      amount: null,
      useForMeals: true,
    };

    expect(dto).toBeDefined();
  });

  it('返す在庫品では献立に使うかどうかを省略できない', () => {
    // ADR-086: 返す在庫品は献立に使うかどうかを必ず載せる。
    // @ts-expect-error 献立に使うかどうかのキーが無い値は在庫品の表現ではない
    const dto: StockItemDto = {
      id: stockItemId,
      name: 'にんじん',
      ingredientId: null,
      amount: null,
      expiryDate: null,
    };

    expect(dto).toBeDefined();
  });

  it('期限に Date を渡せない', () => {
    // 規則6: 期限は YYYY-MM-DD の文字列。時刻もタイムゾーンも持たない。
    const dto: StockItemDto = {
      id: stockItemId,
      name: 'にんじん',
      ingredientId: null,
      amount: null,
      // @ts-expect-error Date は契約に無い
      expiryDate: new Date('2026-09-30'),
      useForMeals: true,
    };

    expect(dto).toBeDefined();
  });

  it('分量を数値と単位に分けて渡せない', () => {
    // 規則7 / ADR-010: 分量は自由文字列。数値と単位に分解しない。
    const dto: StockItemDto = {
      id: stockItemId,
      name: 'にんじん',
      ingredientId: null,
      // @ts-expect-error 数値は契約に無い
      amount: 200,
      expiryDate: null,
      useForMeals: true,
    };

    expect(dto).toBeDefined();
  });

  it('在庫品の表現に世帯を持たせられない', () => {
    // 規則1 / C-9 / NFR-09: 世帯は認証された利用者から定まる。本文には書かせない。
    const dto: StockItemDto = {
      id: stockItemId,
      name: 'にんじん',
      ingredientId: null,
      amount: null,
      expiryDate: null,
      useForMeals: true,
      // @ts-expect-error 世帯は契約に無い
      householdId: '11111111-1111-4111-8111-111111111111',
    };

    expect(dto).toBeDefined();
  });
});

describe('登録の入力 RegisterStockItemInput', () => {
  it('名称と献立に使うかどうかだけで登録の入力を組み立てられる', () => {
    // FR-01 / FR-13 / 規則3: 省略と null は同義。名称と献立に使うかどうかだけで登録できる。
    const input: RegisterStockItemInput = { name: 'にんじん', useForMeals: true };

    expect(input.name).toBe('にんじん');
  });

  it('食材・分量・期限に null を明示した登録の入力も組み立てられる', () => {
    // 規則3: 省略しても null を書いてもよい。
    const input: RegisterStockItemInput = {
      name: 'にんじん',
      ingredientId: null,
      amount: null,
      expiryDate: null,
      useForMeals: true,
    };

    expect(input.ingredientId).toBeNull();
    expect(input.amount).toBeNull();
    expect(input.expiryDate).toBeNull();
  });

  it('名称を省いた登録の入力は組み立てられない', () => {
    // 規則2 / FR-01: 名称は必須。
    // @ts-expect-error 名称の無い登録の入力は契約に無い
    const input: RegisterStockItemInput = { amount: '2本', useForMeals: true };

    expect(input).toBeDefined();
  });

  it('名称に null を渡せない', () => {
    // 規則2: 名称だけは「無し」を表せない。
    // @ts-expect-error 名称は string
    const input: RegisterStockItemInput = { name: null, useForMeals: true };

    expect(input).toBeDefined();
  });

  it('空文字の名称は契約では拒まない', () => {
    // 規則2 / domain-model 4章: 空の名称を断るのはドメインの createStockItem であって、型ではない。
    const input: RegisterStockItemInput = { name: '', useForMeals: true };

    expect(input.name).toBe('');
  });

  it('登録の入力に世帯を含められない', () => {
    // 規則1 / ADR-087 決定2: 世帯は認証された利用者から定まる。
    const input: RegisterStockItemInput = {
      name: 'にんじん',
      useForMeals: true,
      // @ts-expect-error 世帯は契約に無い
      householdId: '11111111-1111-4111-8111-111111111111',
    };

    expect(input).toBeDefined();
  });

  it('登録の入力に識別子を含められない', () => {
    // 設計書 5章 / FR-01: 識別子はサーバが採番する。
    const input: RegisterStockItemInput = {
      name: 'にんじん',
      useForMeals: true,
      // @ts-expect-error 識別子は契約に無い
      id: stockItemId,
    };

    expect(input).toBeDefined();
  });

  it('登録の入力で献立に使うかどうかを省略できない', () => {
    // FR-01 / ADR-086: 献立に使うかどうかは必須。既定値を契約に置かない。
    // @ts-expect-error 献立に使うかどうかの無い登録の入力は契約に無い
    const input: RegisterStockItemInput = { name: 'にんじん' };

    expect(input).toBeDefined();
  });

  it('登録の入力の献立に使うかどうかに null を渡せない', () => {
    // ADR-086: 献立に使うかどうかは「無し」を表せない。
    // @ts-expect-error 献立に使うかどうかは boolean
    const input: RegisterStockItemInput = { name: 'にんじん', useForMeals: null };

    expect(input).toBeDefined();
  });
});

describe('更新の入力 UpdateStockItemInput', () => {
  it('分量と期限を置き換える更新の入力を組み立てられる', () => {
    // FR-05: 編集できるのは分量と期限。
    const input: UpdateStockItemInput = {
      amount: '1本',
      expiryDate: '2026-10-01',
      useForMeals: true,
    };

    expect(input.amount).toBe('1本');
    expect(input.expiryDate).toBe('2026-10-01');
  });

  it('期限を null にして消すことを表せる', () => {
    // 規則4 / FR-13: 常に置き換えとして扱うので、null が「消す」を表す。
    const input: UpdateStockItemInput = { amount: null, expiryDate: null, useForMeals: true };

    expect(input.amount).toBeNull();
    expect(input.expiryDate).toBeNull();
  });

  it('更新の入力で分量を省略できない', () => {
    // 規則4: 省略を許すと「触っていない」と「消す」が区別できない。
    // @ts-expect-error 分量の無い更新の入力は契約に無い
    const input: UpdateStockItemInput = { expiryDate: '2026-10-01', useForMeals: true };

    expect(input).toBeDefined();
  });

  it('更新の入力で期限を省略できない', () => {
    // 規則4: 同上。期限を消す操作を表せなくなる。
    // @ts-expect-error 期限の無い更新の入力は契約に無い
    const input: UpdateStockItemInput = { amount: '1本', useForMeals: true };

    expect(input).toBeDefined();
  });

  it('更新の入力に名称を含められない', () => {
    // 規則5 / FR-05: 名称は編集できない。
    const input: UpdateStockItemInput = {
      amount: '1本',
      expiryDate: '2026-10-01',
      useForMeals: true,
      // @ts-expect-error 名称は契約に無い
      name: 'たまねぎ',
    };

    expect(input).toBeDefined();
  });

  it('更新の入力で献立に使うかどうかを省略できない', () => {
    // FR-05 / ADR-086: 常に置き換えとして扱うので省略を許さない。
    // @ts-expect-error 献立に使うかどうかの無い更新の入力は契約に無い
    const input: UpdateStockItemInput = { amount: '1本', expiryDate: '2026-10-01' };

    expect(input).toBeDefined();
  });

  it('更新の入力の献立に使うかどうかに null を渡せない', () => {
    // ADR-086: 献立に使うかどうかは「無し」を表せない。
    const input: UpdateStockItemInput = {
      amount: '1本',
      expiryDate: '2026-10-01',
      // @ts-expect-error 献立に使うかどうかは boolean
      useForMeals: null,
    };

    expect(input).toBeDefined();
  });
});

describe('一覧の出力 ListStockItemsOutput', () => {
  it('在庫が0件の一覧を表せる', () => {
    // FR-04 / 規則9: 配列は包む。空でも同じ形で返る。
    const output: ListStockItemsOutput = { stockItems: [] };

    expect(output.stockItems.length).toBe(0);
  });

  it('同じ名称の在庫品が2件並ぶ一覧を表せる', () => {
    // 規則11 / ADR-007: 買った日が違えば期限が違う。一覧は一意化も統合もしない。
    const output: ListStockItemsOutput = {
      stockItems: [
        stockItemDto(stockItemId, 'にんじん', '2026-09-20'),
        stockItemDto(anotherStockItemId, 'にんじん', '2026-09-30'),
      ],
    };

    expect(output.stockItems.length).toBe(2);
  });

  it('一覧の出力に配列を直接渡せない', () => {
    // 規則9 / FR-07: 包んでおけば、後から絞り込みの条件を足しても壊れない。
    const dto = stockItemDto(stockItemId, 'にんじん', null);

    // @ts-expect-error 配列そのものは一覧の出力ではない
    const output: ListStockItemsOutput = [dto];

    expect(output).toBeDefined();
  });

  it('在庫品を識別子で引く対応表を渡せない', () => {
    // 規則8 / FR-04: 並び順に意味がある（先頭が期限の近いもの）。対応表では順序が保てない。
    const dto = stockItemDto(stockItemId, 'にんじん', null);

    // @ts-expect-error 対応表は一覧の出力ではない
    const output: ListStockItemsOutput = { stockItems: { [stockItemId]: dto } };

    expect(output).toBeDefined();
  });
});
