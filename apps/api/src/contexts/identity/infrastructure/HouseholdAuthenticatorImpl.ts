import { verifyWithJwks } from 'hono/jwt';
import type { HouseholdAuthenticator } from '../domain/port/HouseholdAuthenticator.js';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import { householdIdOf } from '../../../shared/domain/HouseholdId.js';
import { IdentityRuleViolation } from '../domain/error/IdentityRuleViolation.js';

/**
 * アクセストークンの検証に使う設定（B-07g 設計書 5章）。
 *
 * **`issuer` / `audience` は省略できない**（ADR-043 決定3）。hono は空の `iss` / `aud` を
 * 「照合しない」と読むため、任意にすると照合が消えたことに気づけない（規則5）。
 */
export type AccessTokenVerification = {
  jwksUri: string;
  algorithm: 'ES256';
  issuer: string;
  audience: string;
};

/**
 * JWKS の応答のうち、この層が読む2つだけ（設計書5章・9章）。
 *
 * **`Response` を書かない** — フレームワーク由来の型を腐敗防止層の口に出さず（ADR-003）、
 * 実行環境の型を持たないテスト側でも同じ型を満たせるようにするためである。
 */
export type JwksResponse = { readonly ok: boolean; json(): Promise<unknown> };

/** JWKS を取りに行く口。既定は実行環境の `fetch`。テストはここを差し替える（設計書5章）。 */
export type FetchJwks = (jwksUri: string) => Promise<JwksResponse>;

/** 検証に使う鍵1本。hono は型を輸出しないので引数から引く（設計書5章）。 */
type AccessTokenKey = NonNullable<Parameters<typeof verifyWithJwks>[1]['keys']>[number];

/** 検証を通ったクレームの集まり。同じく戻り値から引く（先行 B-07e 規則11）。 */
type VerifiedClaims = Awaited<ReturnType<typeof verifyWithJwks>>;

/**
 * `HouseholdAuthenticator` の実装（B-07g 設計書 4章・5章）。
 *
 * **腐敗防止層である**（ADR-005）。JWKS・署名・`kid` という外の語はこのファイルに閉じ、
 * `domain/` と `usecase/` には `HouseholdId` と `IdentityRuleViolation` だけが出ていく。
 * 実装の生成は `main.ts` に任せる（B-09。今周はどこからも結線されない）。
 *
 * **断り方は2つに分かれる**（設計書7章）。アクセストークンが通らないのは `IdentityRuleViolation`
 * で、api 層が 401 に写す。**設定が空であること（規則5）と鍵の取得の失敗（規則7）はそちらに
 * 包まない** — 利用者が取り直しても直らない失敗であり、401 に化けると気づけないためである。
 * 包まない失敗に専用の型は起こさない（規則7b）。
 *
 * **鍵は最初の検証のときに1度だけ取りに行き、成功した取得を保持する**（規則6 / ADR-043 結果2）。
 * 検証の成否は覚えない（規則11）。
 */
export class HouseholdAuthenticatorImpl implements HouseholdAuthenticator {
  /**
   * 進行中または成功した鍵の取得（規則6 / ADR-043 結果2）。
   *
   * **取得そのものを持つ**ので、1度目が終わる前に来た検証は同じ取得を待つ。成功した取得は
   * そのまま残り、2度目以降の検証は取りに行かない。**失敗した取得は `null` に戻して捨てる**
   * （規則7）— 覚えたままにすると、JWKS が直ってもインスタンスの寿命のあいだ断り続ける。
   *
   * 鍵の入れ替えへの追従はインスタンスの寿命に等しい（ADR-043 結果3。設計書10章）。
   */
  private accessTokenKeysFetch: Promise<readonly AccessTokenKey[]> | null = null;

  constructor(
    private readonly verification: AccessTokenVerification,
    private readonly fetchJwks: FetchJwks = (jwksUri) => fetch(jwksUri),
  ) {}

  /**
   * 署名・アルゴリズム・`kid`・`iss`・`aud`・期限・`sub` の**すべて**が通ったときだけ世帯を返す
   * （規則1 / ADR-043 結果4 / NFR-09）。1つでも通らなければ `HouseholdId` を作らない —
   * 検証を通らない値から作った世帯をクレームに張ることは、任意の世帯になりすませることと
   * 同じである（ADR-029 結果2）。
   *
   * **成否を覚えない**（規則11）。呼ばれるたびに検証する — 覚えると、下で見ている期限が
   * 二度目以降に効かなくなる。覚えてよいのは鍵だけである（規則6）。
   *
   * @throws IdentityRuleViolation アクセストークンが通らないとき（設計書7章）
   */
  async authenticate(accessToken: string): Promise<HouseholdId> {
    // 設定が空なら、鍵を取りに行く前に断る（規則5 / ADR-043 決定3）。断るのは検証時であって
    // 構築時ではない — 設計書7章が「設定が空」を認証の結末の表に置いている。
    requireConfiguredVerification(this.verification);

    // アクセストークンの正規化はこの層の仕事である（規則11）。ユースケースは受け取ったものを
    // 加工せずに渡してくるので、前後の空白はここで落とす。
    const normalizedAccessToken = accessToken.trim();

    const claims = await this.verifyClaims(normalizedAccessToken);

    // hono は `exp` が**あるときだけ**期限を見るため、持たないアクセストークンは素通りする
    // （規則9 / ADR-043 結果4）。無期限のアクセストークンを通すと失効の手段が消えるので、
    // この層が明示的に断る。
    if (claims.exp === undefined) {
      throw new IdentityRuleViolation(
        'accessToken.invalid',
        'アクセストークンが有効期限を持たない',
      );
    }

    return toHouseholdId(claims.sub);
  }

  /**
   * JWKS から引いた鍵で検証する（規則1〜4）。
   *
   * **期待するアルゴリズムは設定の1つだけを `allowedAlgorithms` に渡し、ヘッダーの `alg` を
   * 信用しない**（規則2 / ADR-043 決定2）。`iss` と `aud` は必ず照合する（規則4 /
   * ADR-043 決定3）— 設定が省略を許さなくなったので、先行の条件つき spread は要らない。
   *
   * **`jwks_uri` を hono に渡さない**（規則6 / ADR-043 結果2）。渡すと hono が検証のたびに
   * 取りに行く。鍵をどこから得るかはこちらが決める。
   */
  private async verifyClaims(normalizedAccessToken: string): Promise<VerifiedClaims> {
    const keys = await this.keysForAlgorithm();

    try {
      return await verifyWithJwks(normalizedAccessToken, {
        keys,
        verification: { iss: this.verification.issuer, aud: this.verification.audience },
        allowedAlgorithms: [this.verification.algorithm],
      });
    } catch (thrown) {
      throw toRejection(thrown);
    }
  }

  /**
   * 検証に渡す鍵、すなわち**設定したアルゴリズムを名乗る鍵だけ**を返す（規則2b / ADR-043 決定2）。
   *
   * hono の照合は `if (matchingKey.alg && matchingKey.alg !== header.alg)` であり、
   * **`alg` を名乗らない鍵は照合を素通りする。** 絞らずに渡すと、検証に使うアルゴリズムを
   * 決めるのがヘッダーの `alg` だけになり、縛りが2枚から1枚に減る。絞った結果 `kid` が
   * 引けなければ、hono は `kid` が JWKS に無いときと同じ断り方になる（規則8）。
   * 実環境の鍵は `alg: 'ES256'` を名乗る（2026-09-19 実測。設計書10章）。
   *
   * **`try` の外に置く**（規則7 / ADR-002）。鍵が引けないのはアクセストークンの性質ではなく、
   * 利用者が取り直しても直らないので、`IdentityRuleViolation` に写して 401 に化けさせない。
   *
   * **絞った結果が0件でも、それは取得の失敗ではない**（規則7c）。`kid` が引けなかったのと
   * 同じ結末（`accessToken.invalid`）になるよう、hono に渡して断らせる。
   */
  private async keysForAlgorithm(): Promise<AccessTokenKey[]> {
    const keys = await this.heldAccessTokenKeys();

    return keys.filter((key) => key.alg === this.verification.algorithm);
  }

  /**
   * 保持した鍵を返す。まだ無ければ**1度だけ**取りに行く（規則6 / ADR-043 結果2）。
   *
   * 取得を promise のまま持つことが「同時に走る検証は同じ取得を待つ」を担う。1度目が
   * 終わる前に来た検証も、同じ取得を待って同じ鍵を得る。
   * **失敗したときは持っているものを捨てて投げ直す**（規則7）— 拒否された promise を
   * 覚えたままにすると、次の検証が取り直せなくなる。投げ直すのは**受け取ったものと同一の
   * 例外**であり、包まない（規則7b）。
   */
  private async heldAccessTokenKeys(): Promise<readonly AccessTokenKey[]> {
    this.accessTokenKeysFetch ??= this.fetchAccessTokenKeys();

    try {
      return await this.accessTokenKeysFetch;
    } catch (thrown) {
      this.accessTokenKeysFetch = null;
      throw thrown;
    }
  }

  /**
   * JWKS を取りに行き、応答が使えることを確かめて鍵の列を返す（規則7 / ADR-043 結果2）。
   *
   * 取得の失敗は**世帯を作らずに、`IdentityRuleViolation` に包まずに**失敗する
   * （規則7・7b / ADR-002）。`ok` でない応答の本体が鍵の形をしていることはあり、
   * **見ないとそれを信用してしまう。**
   *
   * 本体が読めないとき（`json()` が失敗するとき）は、外から来た例外を**そのまま伝える**
   * （規則7b）。この層が見つけた不備だけを素の `Error` で断る。
   */
  private async fetchAccessTokenKeys(): Promise<readonly AccessTokenKey[]> {
    const response = await this.fetchJwks(this.verification.jwksUri);

    if (!response.ok) {
      throw new Error('JWKS の応答が ok でない');
    }

    return accessTokenKeysOf(await response.json());
  }
}

/**
 * 取得した本体から鍵の列を読む（規則7・7c / ADR-005）。
 *
 * 本体は外から来たものなので、形を信用せずに読む — `keys` が無い・配列でない・**空の列**は
 * どれも取得の失敗であり、素の `Error` で断る（規則7・7b）。
 *
 * **「空」の判定はここ、つまり取得した本体に対してだけ行う**（規則7c）。`alg` で絞った結果に
 * 対して行うと、鍵が1本も無いことと**`kid` が引けないこと**が同じ結末に潰れる — 前者は
 * 取得の失敗（包まない例外）、後者は `accessToken.invalid` であり、別の結末である（規則2b・規則8）。
 *
 * 鍵1本ずつの中身は検査しない。通らない鍵はこのあと hono が検証で断る。
 */
function accessTokenKeysOf(body: unknown): readonly AccessTokenKey[] {
  const keys = (body as { readonly keys?: unknown } | null)?.keys;

  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('JWKS の応答が鍵の列を持たない');
  }

  return keys as readonly AccessTokenKey[];
}

/**
 * 検証に要る設定が空でないことを確かめる（規則5 / ADR-043 決定3 / ADR-002）。
 *
 * **`IdentityRuleViolation` に包まない。素の `Error` で断る**（規則7b）。hono は空文字の
 * `iss` / `aud` を「照合しない」と読む（`if (iss)`）ため、包んで通常の断りに混ぜると
 * **照合が消えたことが 401 に化けて気づけない。** 空白だけの設定も同じ扱いにする —
 * そちらは照合が消えるのではなく「空白と一致しない」ので全件を断るが、どちらに転んでも
 * 設定の不備であって、アクセストークンの規則違反ではない。
 *
 * 包まない例外に専用の型を起こさない（規則7b / ADR-025）。api 層の写像は
 * `name === 'IdentityRuleViolation'` だけを見るので、型で捕まえる者が居ない。
 *
 * message には**どの設定が空か**だけを載せる。設定の値そのものは載せない（NFR-09）。
 */
function requireConfiguredVerification(verification: AccessTokenVerification): void {
  const blankSettings = (['jwksUri', 'issuer', 'audience'] as const).filter(
    (setting) => verification[setting].trim() === '',
  );

  if (blankSettings.length > 0) {
    throw new Error(`アクセストークンの検証の設定が空である: ${blankSettings.join(', ')}`);
  }
}

/**
 * hono の例外をこのドメインの断り方に写す（規則12 / ADR-005）。
 *
 * 見分けは `name` で行う。例外クラスは `hono/jwt` から再輸出されておらず、
 * 深い経路を名指しすると hono の内部構成に縛られるためである。
 *
 * **`JwtTokenExpired` だけを `accessToken.expired` に写し、`Jwt` で始まる残りは
 * まとめて `accessToken.invalid` に写す。** 個別に列挙すると、hono が検証を1つ足した日に
 * その例外型が腐敗防止層の外へ漏れる。期限切れだけを分けるのは、**取り直せば回復する失敗**
 * だからである（7章）。
 *
 * `Jwt` で始まらない例外（JWKS を取りに行けない等、アクセストークン以前の失敗）は
 * **包まずそのまま伝える** — 写せない失敗を握りつぶさない（ADR-002 / 7章末行）。
 */
function toRejection(thrown: unknown): unknown {
  if (!(thrown instanceof Error) || !thrown.name.startsWith('Jwt')) {
    return thrown;
  }

  // message にアクセストークン本体もクレームの中身も載せない（規則12 / NFR-09）。hono の
  // message にはトークン全体（`token (…) expired`）やペイロード全体（`aud` 無し）が載るので、
  // ここで包み直して捨てる。
  if (thrown.name === 'JwtTokenExpired') {
    return new IdentityRuleViolation(
      'accessToken.expired',
      'アクセストークンの有効期限が切れている',
    );
  }
  return new IdentityRuleViolation('accessToken.invalid', 'アクセストークンが検証を通らない');
}

/**
 * `sub` を世帯の識別子にする（規則10 / ADR-028 / ADR-043 結果5）。
 *
 * hono は `sub` を見ないので、文字列であることと、前後の空白を落とした結果が
 * 空でないことはこの層が確かめる。空の世帯を張っても例外にはならず、
 * **問い合わせが0行に化けて黙る**（ADR-029 理由(1)）ため、ここで断る。
 *
 * **世帯は `sub` からしか作らない。** 他のクレームが世帯らしき値を名乗っていても見ない
 * （NFR-09 / ADR-029 結果2）。
 */
function toHouseholdId(sub: unknown): HouseholdId {
  if (typeof sub !== 'string') {
    throw new IdentityRuleViolation(
      'accessToken.subjectMissing',
      'アクセストークンが世帯を示していない',
    );
  }

  const trimmedSub = sub.trim();
  if (trimmedSub === '') {
    throw new IdentityRuleViolation(
      'accessToken.subjectMissing',
      'アクセストークンが世帯を示していない',
    );
  }

  return householdIdOf(trimmedSub);
}
