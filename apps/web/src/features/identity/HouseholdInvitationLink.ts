/**
 * web の origin とトークンから招待リンクを組む（ADR-087 決定4）。
 *
 * `webOrigin` は末尾の `/` を持たない値（`location.origin`）で、読むのは `main.tsx` である
 * （`docs/testing.md` 5章）。トークンは URL の成分として符号化し、クエリの途中で切れないようにする。
 */
export function householdInvitationLink(webOrigin: string, token: string): string {
  return `${webOrigin}/?invite=${encodeURIComponent(token)}`;
}
