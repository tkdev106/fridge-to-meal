/**
 * web の origin とトークンから招待リンクを組む（ADR-087 決定4）。
 *
 * `webOrigin` は末尾の `/` を持たない値（`location.origin`）で、読むのは `main.tsx` である
 * （`docs/testing.md` 5章）。トークンは URL の成分として符号化し、クエリの途中で切れないようにする。
 */
export function householdInvitationLink(webOrigin: string, token: string): string {
  return `${webOrigin}/?invite=${encodeURIComponent(token)}`;
}

/**
 * クエリ（`location.search`）から招待のトークンを読む。無い・空文字なら `null`。
 * 使えるトークンかどうかは確かめない（決めるのはサーバ）。
 */
export function invitationTokenOf(search: string): string | null {
  const token = new URLSearchParams(search).get('invite');
  return token === null || token === '' ? null : token;
}
