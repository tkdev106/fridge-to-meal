// `Authorization` ヘッダからアクセストークンを取り出す（B-75 設計書 4章 / ADR-032）。

/**
 * `Authorization: Bearer <token>` からアクセストークンを取り出す（NFR-09）。
 *
 * ヘッダが無い / 方式が `Bearer` でない / 値が空のとき、**api は独自に断らず空文字を渡す**。
 * 「提示されていない」の判定は `IdentifyHousehold` の1か所に残す。方式名の照合は大小を区別しない。
 * **区切りは最初の1空白**とし、残りは値の一部として渡す（正規化は腐敗防止層の仕事である）。
 *
 * **同じ規則の写しが献立と在庫の側にある**（`meal/api/AccessToken.ts` と
 * `pantry/api/StockItemRoutes.ts`）。コンテキストをまたぐ api どうしの import は依存ルールが
 * 禁じるため1本にまとめられない — 規則を動かすときは3つとも変える。
 */
export function extractAccessToken(authorizationHeader: string | undefined): string {
  if (authorizationHeader === undefined) return '';

  const separatorIndex = authorizationHeader.indexOf(' ');
  if (separatorIndex < 0) return '';

  const scheme = authorizationHeader.slice(0, separatorIndex);
  if (scheme.toLowerCase() !== 'bearer') return '';

  return authorizationHeader.slice(separatorIndex + 1);
}
