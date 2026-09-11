// feature flag の読み出しはここ1か所だけ（ADR-024 決定2 / B-10 設計 規則1）。
//
// 有効になるのは値が文字列 'true' と厳密一致するときだけで、大文字小文字も前後の空白も
// 吸収しない（ADR-024 決定1）。未指定・空文字列・'1'・'TRUE' はすべて無効に倒れる —
// 指定を忘れた環境が「未完成が見えている」側に倒れないため（同 結果4）。
//
// 値はこのモジュールの読み込み時に1度だけ決まり、以後変わらない。実行時に切り替える
// 手段は置かない（同 結果3）。vite build が import.meta.env.VITE_FEATURE_* を定数へ畳み、
// 無効側の分岐を成果物から落とすため、切り替えには再ビルドが要る。
export const features = {
  pantryList: import.meta.env.VITE_FEATURE_PANTRY_LIST === 'true',
} as const;
