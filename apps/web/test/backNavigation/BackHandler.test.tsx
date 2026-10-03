// @vitest-environment jsdom
/**
 * 端末の「戻る」の hook `useBackHandler` と provider（B-75 設計 5章 / 6章 規則4・5・10）。
 *
 * 継ぎ目は記憶上の `FixedBackNavigation` に差し替え、`pressBack()` で「利用者が戻るを
 * 押した」ことにする。**履歴の出し入れはここでは見ない** — それは
 * `BackNavigationImpl.test.ts` の持ち分である。
 *
 * **`vi.fn()` で呼び出しを数えない**（`docs/testing.md` 2章）。口が呼ばれたことは、テストが
 * 持つ配列 `closed` に名前を積む形で観る。受け取ったかどうかは `pressBack()` の戻り値で観る。
 */

import { describe, expect, it } from 'vitest';
import { act, render, screen } from '../support/dom/renderComponent.js';
import { FixedBackNavigation } from '../support/backNavigation/FixedBackNavigation.js';
import { BackNavigationProvider, useBackHandler } from '../../src/backNavigation/BackHandler.js';
import type { BackHandlerRank } from '../../src/backNavigation/BackNavigation.js';

/** 戻るで閉じる口を登録するだけの部品。呼ばれたら `closed` に `name` を積む。 */
function Closable(props: {
  readonly name: string;
  readonly closed: string[];
  readonly active?: boolean;
  readonly rank?: BackHandlerRank;
}) {
  const { name, closed, active = true, rank } = props;
  useBackHandler(
    active,
    () => {
      closed.push(name);
    },
    rank,
  );

  return <p>{name}</p>;
}

/** 戻るを押す。口が呼ばれたら `true`。 */
function pressBack(backNavigation: FixedBackNavigation): boolean {
  let received = false;
  act(() => {
    received = backNavigation.pressBack();
  });

  return received;
}

describe('端末の戻るの hook useBackHandler', () => {
  it('active が真の部品を描いていると、戻るでその口が呼ばれる', () => {
    const backNavigation = new FixedBackNavigation();
    const closed: string[] = [];
    render(
      <BackNavigationProvider backNavigation={backNavigation}>
        <Closable name="detail" closed={closed} />
      </BackNavigationProvider>,
    );

    pressBack(backNavigation);

    // 規則1・5: 見えている間は登録されている。
    expect(closed).toEqual(['detail']);
  });

  it('active が偽の間は、戻るを受け取らない', () => {
    const backNavigation = new FixedBackNavigation();
    const closed: string[] = [];
    render(
      <BackNavigationProvider backNavigation={backNavigation}>
        <Closable name="detail" closed={closed} active={false} />
      </BackNavigationProvider>,
    );

    // 規則3・6: 登録しない回は戻るがアプリを離れる側へ落ちる。
    expect(pressBack(backNavigation)).toBe(false);
  });

  it('active が真から偽に変わると、以後は戻るを受け取らない', () => {
    const backNavigation = new FixedBackNavigation();
    const closed: string[] = [];
    const { rerender } = render(
      <BackNavigationProvider backNavigation={backNavigation}>
        <Closable name="detail" closed={closed} active />
      </BackNavigationProvider>,
    );

    rerender(
      <BackNavigationProvider backNavigation={backNavigation}>
        <Closable name="detail" closed={closed} active={false} />
      </BackNavigationProvider>,
    );

    // 規則5・8: 閉じたものの口は外す。残すと戻るが空振りする。
    expect(pressBack(backNavigation)).toBe(false);
  });

  it('描き直して口を差し替えると、戻るで呼ばれるのは最新の口である', () => {
    const backNavigation = new FixedBackNavigation();
    const closed: string[] = [];
    const { rerender } = render(
      <BackNavigationProvider backNavigation={backNavigation}>
        <Closable name="before" closed={closed} />
      </BackNavigationProvider>,
    );

    rerender(
      <BackNavigationProvider backNavigation={backNavigation}>
        <Closable name="after" closed={closed} />
      </BackNavigationProvider>,
    );
    pressBack(backNavigation);

    // 設計 5章: onBack は最新のものが呼ばれる（古い描画の状態で閉じない）。
    expect(closed).toEqual(['after']);
  });

  it('rank を省いた口は、後から登録された tab の口より先に呼ばれる', () => {
    const backNavigation = new FixedBackNavigation();
    const closed: string[] = [];
    const { rerender } = render(
      <BackNavigationProvider backNavigation={backNavigation}>
        <Closable name="screen" closed={closed} />
      </BackNavigationProvider>,
    );
    rerender(
      <BackNavigationProvider backNavigation={backNavigation}>
        <Closable name="screen" closed={closed} />
        <Closable name="tab" closed={closed} rank="tab" />
      </BackNavigationProvider>,
    );

    pressBack(backNavigation);

    // 設計 5章 / 規則4: rank の既定は 'screen' である。
    expect(closed).toEqual(['screen']);
  });

  it('provider の無い木でも、useBackHandler を使う部品は描ける', () => {
    render(<Closable name="detail" closed={[]} />);

    // 規則10: 既存のテストと描き方を変えない。
    expect(screen.queryByText('detail')).not.toBeNull();
  });
});
