import { verify } from 'hono/jwt';
import type { HouseholdAuthenticator } from '../domain/port/HouseholdAuthenticator.js';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../shared/domain/HouseholdId.js';
import { IdentityRuleViolation } from '../domain/error/IdentityRuleViolation.js';

/**
 * 資格の検証に使う設定（B-07e 設計書 5章）。
 *
 * `issuer` / `audience` は与えられていれば照合し、無ければ照合しない（規則6）。
 * 何を与えるかを決めるのは結線（B-09）であって、この層ではない。
 */
export type AccessTokenVerification = {
  sharedSecret: string;
  algorithm: 'HS256';
  issuer?: string;
  audience?: string;
};

/** 検証を通ったクレームの集まり。hono は型を輸出しないので戻り値から引く（規則11）。 */
type 検証済みクレーム = Awaited<ReturnType<typeof verify>>;

/**
 * `HouseholdAuthenticator` の実装（B-07e 設計書 4章・5章）。
 *
 * **腐敗防止層である**（ADR-005）。JWT・署名・共有秘密という外の語はこのファイルに閉じ、
 * `domain/` と `usecase/` には `HouseholdId` と `IdentityRuleViolation` だけが出ていく。
 * 実装の生成は `main.ts` に任せる（B-09。今周はどこからも結線されない）。
 */
export class HouseholdAuthenticatorImpl implements HouseholdAuthenticator {
  constructor(private readonly verification: AccessTokenVerification) {}

  /**
   * 署名・アルゴリズム・有効期限・`sub` の4つがすべて通ったときだけ世帯を返す（規則1 / NFR-09）。
   * 1つでも通らなければ `HouseholdId` を作らない — 検証を通らない値から作った世帯を
   * クレームに張ることは、任意の世帯になりすませることと同じである（ADR-029 結果2）。
   *
   * **成否を覚えない**（規則10）。呼ばれるたびに検証する — 覚えると、下で見ている期限が
   * 二度目以降に効かなくなる。
   */
  async authenticate(accessToken: string): Promise<HouseholdId> {
    // 資格の正規化はこの層の仕事である（規則9）。ユースケースは受け取ったものを
    // 加工せずに渡してくるので、前後の空白はここで落とす。
    const 資格 = accessToken.trim();

    const クレーム = await this.検証したクレーム(資格);

    // hono の `verify` は `exp` が**あるときだけ**期限を見るため、持たない資格は素通りする
    // （規則3）。無期限の資格を通すと失効の手段が消えるので、この層が明示的に断る。
    if (クレーム.exp === undefined) {
      throw new IdentityRuleViolation('accessToken.invalid', '資格が有効期限を持たない');
    }

    return 世帯にする(クレーム.sub);
  }

  /**
   * 設定した共有秘密とアルゴリズムで検証する。
   *
   * **期待するアルゴリズムは設定で1つに固定し、トークンのヘッダーが名乗る `alg` を
   * 信用しない**（規則2 / ADR-031 決定2）。`issuer` / `audience` は与えられたときだけ渡す —
   * 渡さなければ hono は照合しない（規則6）。
   */
  private async 検証したクレーム(資格: string): Promise<検証済みクレーム> {
    try {
      return await verify(資格, this.verification.sharedSecret, {
        alg: this.verification.algorithm,
        ...(this.verification.issuer === undefined ? {} : { iss: this.verification.issuer }),
        ...(this.verification.audience === undefined ? {} : { aud: this.verification.audience }),
      });
    } catch (投げられたもの) {
      throw 断り方にした例外(投げられたもの);
    }
  }
}

/**
 * hono の例外をこのドメインの断り方に写す（規則11 / ADR-005）。
 *
 * 見分けは `name` で行う。例外クラスは `hono/jwt` から再輸出されておらず、
 * 深い経路を名指しすると hono の内部構成に縛られるためである。
 *
 * **`JwtTokenExpired` だけを `accessToken.expired` に写し、`Jwt` で始まる残りは
 * まとめて `accessToken.invalid` に写す。** 個別に列挙すると、hono が検証を1つ足した日に
 * その例外型が腐敗防止層の外へ漏れる。期限切れだけを分けるのは、**取り直せば回復する失敗**
 * だからである（7章）。
 *
 * `Jwt` で始まらない例外（共有秘密が渡っていない等、検証以前の設定の誤り）は
 * **包まずそのまま伝える** — 写せない失敗を握りつぶさない（ADR-002 / 7章末行）。
 */
function 断り方にした例外(投げられたもの: unknown): unknown {
  if (!(投げられたもの instanceof Error) || !投げられたもの.name.startsWith('Jwt')) {
    return 投げられたもの;
  }

  // message にトークン本体もクレームの中身も載せない（規則8）。hono の message には
  // トークン全体（`token (…) expired`）やペイロード全体（`aud` 無し）が載るので、
  // ここで包み直して捨てる。
  if (投げられたもの.name === 'JwtTokenExpired') {
    return new IdentityRuleViolation('accessToken.expired', '資格の有効期限が切れている');
  }
  return new IdentityRuleViolation('accessToken.invalid', '資格が検証を通らない');
}

/**
 * `sub` を世帯の識別子にする（規則4 / ADR-028）。
 *
 * hono は `sub` を見ないので、文字列であることと、前後の空白を落とした結果が
 * 空でないことはこの層が確かめる。空の世帯を張っても例外にはならず、
 * **問い合わせが0行に化けて黙る**（ADR-029 理由(1)）ため、ここで断る。
 */
function 世帯にする(sub: unknown): HouseholdId {
  if (typeof sub !== 'string') {
    throw new IdentityRuleViolation('accessToken.subjectMissing', '資格が世帯を示していない');
  }

  const 世帯 = sub.trim();
  if (世帯 === '') {
    throw new IdentityRuleViolation('accessToken.subjectMissing', '資格が世帯を示していない');
  }

  return householdIdOf(世帯);
}
