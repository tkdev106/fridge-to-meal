// 献立のコンテキストの api 層が共有するアクセストークンの取り出し（B-50b 設計書 4章）。
//
// 置き場をファイル1つに分けたのは、同じディレクトリに経路のファイルが2つ
// （`SuggestionRoutes.ts` / `IngredientNameRoutes.ts`）になり、**同じ関数の写しを3本目まで
// 増やさない**ためである。api → 他コンテキストの api の import は依存ルールが禁じているので、
// 在庫（`pantry/api/StockItemRoutes.ts`）の側の写しはそのまま残る。

/**
 * `Authorization: Bearer <token>` からアクセストークンを取り出す（B-50b 規則8 / NFR-09）。
 *
 * **`pantry/api/StockItemRoutes.ts` の同名の関数と同じ規則である**（B-48b 設計書10章 /
 * B-50b 設計書4章）。コンテキストをまたぐ api どうしの import は依存ルールが禁じるため写しが
 * 残る。片方だけ規則を動かすと経路ごとに扱いが食い違うので、変えるときは両方を変える。
 *
 * ヘッダが無い / 方式が `Bearer` でない / 値が空のとき、**api は独自に断らず空文字を渡す** —
 * 「提示されていない」の判定は `IdentifyHousehold` の1か所に残す。方式名の照合は大小を区別しない。
 * **区切りは最初の1空白**とし、残りは値の一部として渡す — 正規化は腐敗防止層の仕事である。
 */
export function extractAccessToken(authorizationHeader: string | undefined): string {
  if (authorizationHeader === undefined) return '';

  const separatorIndex = authorizationHeader.indexOf(' ');
  if (separatorIndex < 0) return '';

  const scheme = authorizationHeader.slice(0, separatorIndex);
  if (scheme.toLowerCase() !== 'bearer') return '';

  return authorizationHeader.slice(separatorIndex + 1);
}
