import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { UserDeleter } from '../domain/port/UserDeleter.js';

/**
 * 世帯の利用者を消す（B-56d 設計書 5章 / ADR-071 決定2）。世帯は第1引数で受け取る（C-9）。
 */
export type DeleteUser = (householdId: HouseholdId) => Promise<void>;

/**
 * 利用者を消すユースケースを組み立てる。**存在を確かめない**（B-56d 規則7）— 消したあとの再要求でも
 * 断らない。口が投げた例外は包まずに伝える — `IdentityRuleViolation` に包むと api 層で 401 に化け、
 * サーバ側の不備を利用者のせいにする（ADR-045）。
 */
export function deleteUser(deps: { userDeleter: UserDeleter }): DeleteUser {
  return (householdId) => deps.userDeleter.delete(householdId);
}
