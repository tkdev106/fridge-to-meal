import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import type { Session } from './session/Session.js';
import { sessionConfigOf } from './session/SessionConfig.js';
import { SessionImpl } from './session/SessionImpl.js';
import { apiBaseUrlOf } from './server/ApiBaseUrl.js';
import type { StockItemRequestsDeps } from './server/StockItemRequests.js';
import {
  deleteStockItem,
  listStockItems,
  registerStockItem,
  updateStockItem,
} from './server/StockItemRequests.js';
import { listIngredientNames } from './server/IngredientNameRequests.js';
import { requestNewMeals, showLatestSuggestion } from './server/SuggestionRequests.js';
import { addCookingRecord, showMeal } from './server/MealRequests.js';

// 継ぎ目の実装を `new` するのはここだけ（`SessionImpl.ts` 規則2 / B-35 設計 6章 規則3）。
// 設定が欠けていれば `sessionConfigOf` の `Error` を**包まずそのまま外へ**出す（規則12 / ADR-045）
// — 利用者が入力を直しても解消しない失敗であり、画面を出しても受け止め手がいない。
const session: Session = new SessionImpl(sessionConfigOf(import.meta.env));

// 経路の継ぎ目を組み立てるのもここだけ（B-22 設計 規則4）。`import.meta.env` を読むのは
// この1か所で、`apiBaseUrlOf` も継ぎ目も渡された値しか見ない — 読ませる相手を結線が決める。
// `VITE_API_BASE_URL` が欠けていれば、こちらも**包まずそのまま外へ**出す（同 規則5 / ADR-045）。
//
// トークンは `Session` の口を**関数で包んで**渡す（同 規則7）。継ぎ目に `Session` の型を
// 渡さないのは、経路の側が認証の実装を知らないままでいるためである（ADR-046 決定3）。
//
// **基点とトークンの出どころは在庫の口で1組である。** 別々に組むと、片方だけ別の基点を
// 見ている状態を作れてしまう（B-24）。
const stockItemRequests: StockItemRequestsDeps = {
  baseUrl: apiBaseUrlOf(import.meta.env),
  accessToken: () => session.accessToken(),
};

const requestStockItems = listStockItems(stockItemRequests);
const sendStockItem = registerStockItem(stockItemRequests);
const requestStockItemDeletion = deleteStockItem(stockItemRequests);
// 更新の口も**同じ基点・同じトークンの組**で作る（B-55 設計 9章）。2つ目の基点を作らない。
const sendStockItemUpdate = updateStockItem(stockItemRequests);

// 提案の口も**同じ基点・同じトークンの組**で作る（B-49a）。別々に組むと、片方だけ別の基点を
// 見ている状態を作れてしまう（B-24 と同じ理由）。`SuggestionRequestsDeps` は
// `StockItemRequestsDeps` と同じ3項目なので、そのまま渡せる。
const requestLatestSuggestion = showLatestSuggestion(stockItemRequests);
// 「新しい献立を求める」操作（B-49b）も同じ基点・同じトークンの組で作る。
const requestNewMealsFn = requestNewMeals(stockItemRequests);

// 食材名の口も**同じ基点・同じトークンの組**で作る（B-50c）。`IngredientNameRequestsDeps` も
// 同じ3項目なので、そのまま渡せる。
const requestIngredientNames = listIngredientNames(stockItemRequests);

// 献立1件の口と調理記録の口も**同じ基点・同じトークンの組**で作る（B-53）。
// `MealRequestsDeps` も同じ3項目なので、そのまま渡せる。
const requestMeal = showMeal(stockItemRequests);
const sendCookingRecord = addCookingRecord(stockItemRequests);

const container = document.getElementById('root');
if (!container) throw new Error('#root が見つからない');

createRoot(container).render(
  <StrictMode>
    <App
      session={session}
      listStockItems={requestStockItems}
      registerStockItem={sendStockItem}
      deleteStockItem={requestStockItemDeletion}
      updateStockItem={sendStockItemUpdate}
      showLatestSuggestion={requestLatestSuggestion}
      requestNewMeals={requestNewMealsFn}
      listIngredientNames={requestIngredientNames}
      showMeal={requestMeal}
      addCookingRecord={sendCookingRecord}
    />
  </StrictMode>,
);
