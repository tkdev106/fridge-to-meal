/**
 * サインインしていないときの画面の出し分け（B-73 設計 6章 規則14・15 / ADR-081）。
 *
 * ログインの画面とアカウント作成の画面のどちらを出すかだけを持つ。**門（`App.tsx`）はこれを
 * 描くだけで、どちらが出ているかを知らない** — 出し分けはサインインしていない間だけの事情であり、
 * サインインすれば門がこの部品ごと外す（先行 `features/pantry/PantryTab.tsx` が一覧と登録を
 * 出し分けるのと同じ置き方）。
 *
 * 切り替えるたびに相手の画面は作り直し、入力は持ち越さない（規則14）。
 */

import { useState } from 'react';
import type { SignInOutcome, SignUpOutcome } from '../../session/Session.js';
import { SignInForm } from './SignInForm.js';
import { SignUpForm } from './SignUpForm.js';

export type SignedOutView = 'signIn' | 'signUp';

export type SignedOutScreenProps = {
  onSignIn: (email: string, password: string) => Promise<SignInOutcome>;
  onSignUp: (email: string, password: string) => Promise<SignUpOutcome>;
};

export function SignedOutScreen({ onSignIn, onSignUp }: SignedOutScreenProps) {
  const [view, setView] = useState<SignedOutView>('signIn');
  // 作成画面から戻ったか。戻った直後だけ `アカウントを作る` に焦点を戻す（規則15）。
  const [returnedFromSignUp, setReturnedFromSignUp] = useState(false);

  if (view === 'signUp') {
    return (
      <SignUpForm
        onSignUp={onSignUp}
        onBackToSignIn={() => {
          setReturnedFromSignUp(true);
          setView('signIn');
        }}
      />
    );
  }

  return (
    <SignInForm
      onSignIn={onSignIn}
      onOpenSignUp={() => setView('signUp')}
      returnedFromSignUp={returnedFromSignUp}
    />
  );
}
