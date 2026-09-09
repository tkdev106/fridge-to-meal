// 在庫の DTO（B-01）。web と api がここだけを共有する（ADR-003）。
//
// ここにあるのは型だけであり、実行時の検証も関数も持たない。受け取った JSON を検めるのは api 層。
// 世帯は認証された利用者から定まるため、どの型にも持たせない（C-9 / ADR-020 / NFR-09）。

/** 在庫品1件。一覧・登録の結果・更新の結果に共通で使う。 */
export type StockItemDto = {
  id: string;
  name: string;
  /** カタログに無い食材は null */
  ingredientId: string | null;
  /** 自由文字列。数値と単位に分けない（ADR-010）。未設定は null */
  amount: string | null;
  /** YYYY-MM-DD。未設定は null */
  expiryDate: string | null;
};

/** 登録の入力（FR-01）。識別子はサーバが採番するため含まない。省略と null は同義。 */
export type RegisterStockItemInput = {
  name: string;
  ingredientId?: string | null;
  amount?: string | null;
  expiryDate?: string | null;
};

/**
 * 更新の入力（FR-05）。識別子は経路で渡す。
 * 常に置き換えとして扱うため省略を許さない。null が「消す」を表す（FR-13）。
 */
export type UpdateStockItemInput = {
  amount: string | null;
  expiryDate: string | null;
};

/** 一覧の出力（FR-04）。並び順に意味があるので配列で包んで返す。 */
export type ListStockItemsOutput = {
  stockItems: StockItemDto[];
};
