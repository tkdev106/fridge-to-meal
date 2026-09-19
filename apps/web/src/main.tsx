import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import type { Session } from './session/Session.js';
import { sessionConfigOf } from './session/SessionConfig.js';
import { SessionImpl } from './session/SessionImpl.js';

// 継ぎ目の実装を `new` するのはここだけ（`SessionImpl.ts` 規則2 / B-35 設計 6章 規則3）。
// 設定が欠けていれば `sessionConfigOf` の `Error` を**包まずそのまま外へ**出す（規則12 / ADR-045）
// — 利用者が入力を直しても解消しない失敗であり、画面を出しても受け止め手がいない。
const session: Session = new SessionImpl(sessionConfigOf(import.meta.env));

const container = document.getElementById('root');
if (!container) throw new Error('#root が見つからない');

createRoot(container).render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
);
