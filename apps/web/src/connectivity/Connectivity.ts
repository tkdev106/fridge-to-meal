/**
 * 接続状態の継ぎ目（B-70 設計 4章・5章 / 6章 規則1〜3 / FR-41）。
 *
 * **画面（門）が見るのはこのファイルの型だけである。** `navigator.onLine` と `online` /
 * `offline` の出来事はこの背後に閉じる（先行 `session/Session.ts`）。
 *
 * **`Connectivity` は用語表の語ではない**（設計 3章）。web の中の継ぎ目の名である。
 */

/** 接続状態の2値。 */
export type ConnectivityState = 'online' | 'offline';

/** 継ぎ目の口。門はこの型だけを受け取る。 */
export type Connectivity = {
  /** 購読を始めた時点の状態をまず1度渡し、以後は変わったときだけ渡す。戻り値で購読をやめる */
  subscribe(onChange: (state: ConnectivityState) => void): () => void;
};
