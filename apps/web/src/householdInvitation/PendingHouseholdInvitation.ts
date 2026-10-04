/** 持ち越し中の招待のトークンを読み・書き・消す継ぎ目（ADR-087 決定4）。例外を投げない。 */
export type PendingHouseholdInvitation = {
  read(): string | null;
  save(token: string): void;
  clear(): void;
};
