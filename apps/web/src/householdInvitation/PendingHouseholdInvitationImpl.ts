/**
 * 持ち越し中の招待のトークンを端末のストレージ（`localStorage`）に置く実装（ADR-087 決定4 / ADR-088）。
 *
 * `localStorage` にするのは、確認メールのリンクが別のタブで開かれても届くようにするため
 * （`sessionStorage` はタブごとに分かれる）。ストレージが投げても例外を外へ出さない —
 * 読みは `null`、書きと消しは何もしない。
 */
import type { PendingHouseholdInvitation } from './PendingHouseholdInvitation.js';

/** ストレージのうち、ここが使うものだけを見る形。 */
export type InvitationStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** ストレージの鍵。 */
const STORAGE_KEY = 'fridgeToMeal.householdInvitation';

export class PendingHouseholdInvitationImpl implements PendingHouseholdInvitation {
  readonly #storage: InvitationStorage;

  constructor(storage: InvitationStorage) {
    this.#storage = storage;
  }

  read(): string | null {
    try {
      return this.#storage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  save(token: string): void {
    try {
      this.#storage.setItem(STORAGE_KEY, token);
    } catch {
      // 保存できなくても画面は続ける。
    }
  }

  clear(): void {
    try {
      this.#storage.removeItem(STORAGE_KEY);
    } catch {
      // 消せなくても画面は続ける。
    }
  }
}
