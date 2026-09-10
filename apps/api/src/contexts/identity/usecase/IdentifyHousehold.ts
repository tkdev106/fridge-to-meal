import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { IdentityRuleViolation } from '../domain/error/IdentityRuleViolation.js';
import type { HouseholdAuthenticator } from '../domain/port/HouseholdAuthenticator.js';

/**
 * 提示されたアクセストークン1つから世帯を定める（NFR-09 / ADR-029 結果2）。
 * 返すのは世帯の識別子だけである（B-07e 規則5）。
 */
export type IdentifyHousehold = (accessToken: string) => Promise<HouseholdId>;

/**
 * 世帯を定めるユースケースを組み立てる。依存は引数で受け取り、実装の生成は
 * `main.ts` に任せる（ADR-002 / B-09）。
 *
 * 認証器が投げた例外は握りつぶさず、型も `rule` も変えずにそのまま呼び出し側へ伝える
 * （HTTP への写像は B-08）。写せない失敗（設定の誤りなど）も同じく素通りさせる
 * （先行の `ListStockItems` と同じ扱い）。
 *
 * 検証の成否をここで覚えない（B-07e 規則10）。同じアクセストークンを2度渡されたら2度とも委ねる —
 * 覚えると、認証器が見ている期限が効かなくなる。
 */
export function identifyHousehold(deps: {
  householdAuthenticator: HouseholdAuthenticator;
}): IdentifyHousehold {
  return async (accessToken) => {
    // 空のアクセストークンは認証器に渡す前に断る（B-07e 規則9 / NFR-09）。空を渡して
    // 返ってきたもので結果を推測しない。
    if (中身が無い(accessToken)) {
      throw new IdentityRuleViolation('accessToken.missing', 'アクセストークンが提示されていない');
    }

    // 受け取ったアクセストークンをそのまま委ねる。**前後の空白を落とした値は渡さない**
    // （B-07e 規則9）— アクセストークンの正規化は腐敗防止層の仕事であり、ここで黙って
    // 加工すると「片側だけ正規化した」ずれが静かに入る。
    return await deps.householdAuthenticator.authenticate(accessToken);
  };
}

/**
 * 断る判定にだけ前後の空白を落とす（B-07e 規則9）。落とした結果が空でありさえ
 * しなければ、アクセストークンの形は見ない — 形を見るのは認証器である（規則1）。
 */
function 中身が無い(accessToken: string): boolean {
  return accessToken.trim() === '';
}
