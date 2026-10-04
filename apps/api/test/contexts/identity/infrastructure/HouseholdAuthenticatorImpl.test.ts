import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseholdAuthenticatorImpl } from '../../../../src/contexts/identity/infrastructure/HouseholdAuthenticatorImpl.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import type { AccessTokenClaims } from '../../../support/identity/AccessSigning.js';
import {
  accessTokenOf,
  accessTokenSignedWithUnknownKeyId,
  accessTokenSignedWithoutKeyId,
  publicAccessTokenKeyWithOtherAlgorithm,
  publicAccessTokenKeyWithoutAlgorithm,
} from '../../../support/identity/AccessSigning.js';
import { FixedFetchJwks } from '../../../support/identity/FixedFetchJwks.js';
import { publicAccessTokenKey } from '../../../support/identity/AccessSigning.js';
import type { AccessTokenVerification } from '../../../../src/contexts/identity/infrastructure/HouseholdAuthenticatorImpl.js';

/** 設定に与える値。何を渡すかを決めるのは結線（B-09）であって、この層ではない。 */
const jwksUri = 'https://ninshou.example/auth/v1/.well-known/jwks.json';
const issuer = 'https://ninshou.example/auth/v1';
const audience = 'authenticated';

const ourHousehold = '11111111-1111-4111-8111-111111111111';
const neighborHousehold = '22222222-2222-4222-8222-222222222222';

/**
 * ヘッダーを自分で組むケースで差し替える base64url のリテラル。
 *
 * **`kid` は `AccessSigning.ts` の `accessTokenKeyId` と同じ値を焼き込んでいる**
 * （JWKS が届ける鍵と引き当てられる状態で、`alg` だけを変えて観察するため）。
 * 鍵の `kid` を変えるときは、この2つの literal も一緒に組み直す。
 */
// {"alg":"HS256","typ":"JWT","kid":"2c9a5e3f-0b7d-4a1e-9f6c-8d3b5a2e7c40"}
const symmetricAlgorithmHeader =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjJjOWE1ZTNmLTBiN2QtNGExZS05ZjZjLThkM2I1YTJlN2M0MCJ9';
// {"alg":"RS256","typ":"JWT","kid":"2c9a5e3f-0b7d-4a1e-9f6c-8d3b5a2e7c40"}
const otherAlgorithmHeader =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjJjOWE1ZTNmLTBiN2QtNGExZS05ZjZjLThkM2I1YTJlN2M0MCJ9';
// {"alg":"none","typ":"JWT"}
const unsignedHeader = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0';

/** 実時刻からの固定オフセットで秒を置く。`exp` / `nbf` / `iat` の本題は前後関係だけである。 */
function secondsFromNow(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

/** 署名・`kid`・`iss`・`aud`・期限・`sub` のどれも通る中身。本題のクレームだけを重ねて使う。 */
function validClaims(): AccessTokenClaims {
  return { sub: ourHousehold, exp: secondsFromNow(3600), iss: issuer, aud: audience };
}

/** 通る中身からクレーム1つを落としたもの。**落ちていること**が本題のケースで使う。 */
function claimsWithout(claim: 'iss' | 'aud' | 'exp' | 'sub'): AccessTokenClaims {
  const claims = validClaims();
  delete claims[claim];
  return claims;
}

/** 与えたアクセストークンのヘッダー部だけを差し替える。署名の鍵は差し替えない。 */
function withReplacedHeader(accessToken: string, encodedHeader: string): string {
  const [, payloadPart = '', signaturePart = ''] = accessToken.split('.');
  return `${encodedHeader}.${payloadPart}.${signaturePart}`;
}

/**
 * 認証器を1つ組む。**本題は JWKS が届ける鍵だけ**なので、それを持つ記憶上の実装を引数に取る。
 * 設定は既定のまま — `issuer` / `audience` は省略できない（ADR-043 決定3）。
 */
function authenticator(fetchJwks: FixedFetchJwks = new FixedFetchJwks()) {
  return new HouseholdAuthenticatorImpl(
    { jwksUri, algorithm: 'ES256', issuer, audience },
    fetchJwks.fetchJwks,
  );
}

/** 投げられた例外そのものを取り出す。**中身を見るのは規則12 のときだけ。** */
async function caughtError(execution: Promise<unknown>): Promise<Error> {
  try {
    await execution;
  } catch (thrown) {
    return thrown as Error;
  }
  throw new Error('例外が投げられなかった');
}

/**
 * 設定の1項目だけを差し替えた認証器（規則5 の4件）。他の項目は既定のまま —
 * **断りの理由を設定だけに絞る**ためである（アクセストークンは通るものを渡す）。
 */
function authenticatorWithVerification(
  overrides: Partial<AccessTokenVerification>,
  fetchJwks: FixedFetchJwks = new FixedFetchJwks(),
) {
  return new HouseholdAuthenticatorImpl(
    { jwksUri, algorithm: 'ES256', issuer, audience, ...overrides },
    fetchJwks.fetchJwks,
  );
}

/** JWKS が届ける正しい本体。**本題は `ok` と本体の形だけ**なので、鍵はここに隠す。 */
const validJwksBody = { keys: [publicAccessTokenKey] };

afterEach(() => {
  vi.useRealTimers();
});

describe('世帯認証器 HouseholdAuthenticatorImpl', () => {
  it('署名・アルゴリズム・kid・iss・aud・期限・sub のすべてが通るアクセストークンから、sub を世帯の識別子として返す', async () => {
    // 規則1・3・4・10 / ADR-043 結果4・結果5: すべてが通ったときだけ sub を世帯の識別子とする。
    const result = await authenticator().authenticate(await accessTokenOf(validClaims()));

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('ヘッダーが対称鍵のアルゴリズムを名乗るアクセストークンを accessToken.invalid で断る', async () => {
    // 規則2 / ADR-043 決定2: 共有秘密の経路はもう無い。対称鍵を名乗るアクセストークンを通すと、
    // JWKS の公開鍵を共有秘密として使う攻撃が成立する。
    const execution = authenticator().authenticate(
      withReplacedHeader(await accessTokenOf(validClaims()), symmetricAlgorithmHeader),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('ヘッダーが設定と違うアルゴリズムを名乗るアクセストークンを accessToken.invalid で断る', async () => {
    // 規則2 / ADR-043 決定2: 期待するアルゴリズムは設定の1つだけを許し、ヘッダーを信用しない。
    const execution = authenticator().authenticate(
      withReplacedHeader(await accessTokenOf(validClaims()), otherAlgorithmHeader),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('JWKS から引いた鍵の alg がヘッダーの alg と違うとき accessToken.invalid で断る', async () => {
    // 規則2・2b / ADR-043 決定2: 鍵の側が別のアルゴリズムを名乗るなら、その鍵で検証しない。
    const execution = authenticator(
      new FixedFetchJwks([publicAccessTokenKeyWithOtherAlgorithm]),
    ).authenticate(await accessTokenOf(validClaims()));

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('JWKS の鍵が alg を名乗らないとき accessToken.invalid で断る', async () => {
    // 規則2b: hono の照合は `if (matchingKey.alg && …)` で、alg を名乗らない鍵を素通りさせる。
    // 渡す鍵を絞らないと、検証に使うアルゴリズムを決めるのがヘッダーの alg だけになり、
    // 縛りが2枚から1枚に減る。実環境の鍵は `alg: 'ES256'` を名乗る（2026-09-19 実測）。
    const execution = authenticator(
      new FixedFetchJwks([publicAccessTokenKeyWithoutAlgorithm]),
    ).authenticate(await accessTokenOf(validClaims()));

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('alg に none を名乗り署名部が空のアクセストークンを accessToken.invalid で断る', async () => {
    // 規則1・2 / ADR-029 結果2: なりすましの経路そのもの。署名を捨てたアクセストークンを
    // 通したら、検証は無かったことになる。
    const [, payloadPart = ''] = (await accessTokenOf(validClaims())).split('.');
    const unsignedAccessToken = `${unsignedHeader}.${payloadPart}.`;

    const execution = authenticator().authenticate(unsignedAccessToken);

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('kid を持たないアクセストークンを accessToken.invalid で断る', async () => {
    // 規則3 / ADR-043 決定2: 鍵は kid で JWKS から引く。名乗らないアクセストークンは通さない。
    const execution = authenticator().authenticate(
      await accessTokenSignedWithoutKeyId(validClaims()),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('JWKS に無い kid を名乗るアクセストークンを accessToken.invalid で断る', async () => {
    // 規則8 / ADR-043 結果2: 偽の kid と入れ替え直後の kid は見分けられないので、
    // 断る側（偽のほう）に揃える。
    const execution = authenticator().authenticate(
      await accessTokenSignedWithUnknownKeyId(validClaims()),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('署名が本文と合わないアクセストークンを accessToken.invalid で断る', async () => {
    // 規則1 / NFR-09 / ADR-029 結果2: 署名を検証せずにクレームを張ることは、なりすましを
    // 許すのと同じ。別の世帯ぶんの署名を継いだだけで通ってはいけない。
    const forOurHousehold = await accessTokenOf(validClaims());
    const forNeighborHousehold = await accessTokenOf({
      ...validClaims(),
      sub: neighborHousehold,
    });
    const [headerPart = '', payloadPart = ''] = forOurHousehold.split('.');
    const [, , otherSignaturePart = ''] = forNeighborHousehold.split('.');

    const execution = authenticator().authenticate(
      `${headerPart}.${payloadPart}.${otherSignaturePart}`,
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('3つの部分に分かれていない文字列を accessToken.invalid で断る', async () => {
    // 規則1 / 7章1行目: 形式不正も同じ断り方に写す。
    const execution = authenticator().authenticate('kore-wa-token-de-nai');

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('iss が設定と違うアクセストークンを accessToken.invalid で断る', async () => {
    // 規則4 / ADR-043 決定3: 別の発行者が署名したアクセストークンで世帯を名乗らせない。
    const execution = authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), iss: 'https://hoka.example' }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('iss を持たないアクセストークンを accessToken.invalid で断る', async () => {
    // 規則4 / ADR-043 決定3: 照合すると決めた以上、名乗らないアクセストークンも通さない。
    const execution = authenticator().authenticate(await accessTokenOf(claimsWithout('iss')));

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('aud が設定と違うアクセストークンを accessToken.invalid で断る', async () => {
    // 規則4 / ADR-043 決定3: 別の宛先に発行されたアクセストークンを使い回させない。
    const execution = authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), aud: 'hoka' }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('aud を持たないアクセストークンを accessToken.invalid で断る', async () => {
    // 規則4: 照合すると決めた以上、名乗らないアクセストークンも通さない。
    const execution = authenticator().authenticate(await accessTokenOf(claimsWithout('aud')));

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('exp を持たないアクセストークンを accessToken.invalid で断る', async () => {
    // 規則9 / ADR-043 結果4: hono は exp があるときだけ検証するため、無いアクセストークンは
    // 素通りする。無期限のアクセストークンを通すと失効の手段が消える。
    const execution = authenticator().authenticate(await accessTokenOf(claimsWithout('exp')));

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('exp が過ぎたアクセストークンを accessToken.expired で断る', async () => {
    // 規則12 / 7章2行目: 取り直せば回復する失敗なので、回復しないものと区別する。
    const execution = authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), exp: secondsFromNow(-3600) }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.expired' });
  });

  it('nbf がまだ来ていないアクセストークンを accessToken.invalid で断る', async () => {
    // 規則12: JwtTokenExpired 以外の Jwt 例外はまとめて accessToken.invalid に写す。
    const execution = authenticator().authenticate(
      await accessTokenOf({
        ...validClaims(),
        nbf: secondsFromNow(3600),
        exp: secondsFromNow(7200),
      }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('iat が未来のアクセストークンを accessToken.invalid で断る', async () => {
    // 規則12: 写さないと hono の JwtTokenIssuedAt が腐敗防止層の外へ漏れる。
    const execution = authenticator().authenticate(
      await accessTokenOf({
        ...validClaims(),
        iat: secondsFromNow(3600),
        exp: secondsFromNow(7200),
      }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('期限切れで断るとき、例外の message にアクセストークンの文字列を載せない', async () => {
    // 規則12 / NFR-09: hono の例外は message にトークン本体を載せる（`token (…) expired`）ので、
    // 包み直して捨てる。**断ったこと自体を先に断定する** — そうしないと、別の理由で投げられた
    // 例外の message もアクセストークンを含まないので、この行は空振りで緑になる。
    const expiredAccessToken = await accessTokenOf({
      ...validClaims(),
      exp: secondsFromNow(-3600),
    });

    const error = await caughtError(authenticator().authenticate(expiredAccessToken));

    expect(error).toBeInstanceOf(IdentityRuleViolation);
    expect(error.message).not.toContain(expiredAccessToken);
  });

  it('aud が無くて断るとき、例外の message に sub の値を載せない', async () => {
    // 規則12 / NFR-09: クレームの中身も message に載せない（hono は payload 全体を載せる）。
    // ここでも、断ったこと自体を先に断定してから中身を見る。
    const error = await caughtError(
      authenticator().authenticate(await accessTokenOf(claimsWithout('aud'))),
    );

    expect(error).toBeInstanceOf(IdentityRuleViolation);
    expect(error.message).not.toContain('11111111-1111-4111-8111-111111111111');
  });

  it('sub の前後の空白を落とした値を世帯とする', async () => {
    // 規則10 / ADR-087 決定2: 落とした結果を返す。空のクレームは0行に化けて黙る（ADR-029 理由(1)）。
    const result = await authenticator().authenticate(
      await accessTokenOf({
        ...validClaims(),
        sub: '  11111111-1111-4111-8111-111111111111  ',
      }),
    );

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('sub を持たないアクセストークンを accessToken.subjectMissing で断る', async () => {
    // 規則10 / 7章3行目: 世帯を定められないアクセストークンから HouseholdId を作らない。
    const execution = authenticator().authenticate(await accessTokenOf(claimsWithout('sub')));

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.subjectMissing' });
  });

  it('sub が文字列でないアクセストークンを accessToken.subjectMissing で断る', async () => {
    // 規則10: hono は sub を見ないので通す。文字列であることはこの層が確かめる。
    const execution = authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), sub: 42 }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.subjectMissing' });
  });

  it('sub が空文字のアクセストークンを accessToken.subjectMissing で断る', async () => {
    // 規則10 / ADR-029 理由(1): 空の世帯を張ると、例外ではなく0行になって黙る。
    const execution = authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), sub: '' }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.subjectMissing' });
  });

  it('sub が空白だけのアクセストークンを accessToken.subjectMissing で断る', async () => {
    // 規則10: 前後の空白を落とした結果が空でないことまでを見る。
    const execution = authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), sub: ' \t ' }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.subjectMissing' });
  });

  it('sub 以外に世帯らしき値を持つクレームがあっても、sub の値を世帯とする', async () => {
    // 設計書9章末行 / NFR-09 / ADR-029 結果2: 世帯は検証を通った sub からしか作らない。
    // C-9 の代わりにここで押さえる（この層はリポジトリを触らない）。
    const result = await authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), sub: ourHousehold, household_id: neighborHousehold }),
    );

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('前後に空白の付いたアクセストークンを、空白を落として検証する', async () => {
    // 規則11 前半: アクセストークンの正規化は腐敗防止層の仕事であり、
    // ユースケースは受け取ったものを加工せずに渡してくる。
    const validAccessToken = await accessTokenOf(validClaims());

    const result = await authenticator().authenticate(` ${validAccessToken} `);

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('一度通ったアクセストークンでも、期限を跨いだ2度目は accessToken.expired で断る', async () => {
    // 規則11 後半: 検証の成否を覚えると、期限が2度目以降に効かなくなる。
    // 覚えてよいのは鍵だけであり、期限を見るのはアクセストークン側である。
    const validAccessToken = await accessTokenOf(validClaims());
    const householdAuthenticator = authenticator();

    const first = await householdAuthenticator.authenticate(validAccessToken);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 7200 * 1000));
    const second = householdAuthenticator.authenticate(validAccessToken);

    expect(first).toBe('11111111-1111-4111-8111-111111111111');
    await expect(second).rejects.toThrow(IdentityRuleViolation);
    await expect(second).rejects.toMatchObject({ rule: 'accessToken.expired' });
  });

  it('jwksUri が空の設定は、鍵を取りに行く前に断る', async () => {
    // 規則5 / ADR-043 決定3 / ADR-002: 取りに行く先が無いなら検証は成立しない。
    // 包んで通常の断りに混ぜると、設定の不備が 401 に化けて気づけない。
    const fetchJwks = new FixedFetchJwks();

    const error = await caughtError(
      authenticatorWithVerification({ jwksUri: '' }, fetchJwks).authenticate(
        await accessTokenOf(validClaims()),
      ),
    );

    expect(error).not.toBeInstanceOf(IdentityRuleViolation);
    expect(fetchJwks.callCount).toBe(0);
  });

  it('issuer が空の設定を、アクセストークンの規則違反に化けさせずに断る', async () => {
    // 規則5 / 7章末行: hono は空文字の iss を「照合しない」と読む（`if (iss)`）。
    // 包んで断ると、**照合が消えたことが 401 に化けて**気づけない。
    const error = await caughtError(
      authenticatorWithVerification({ issuer: '' }).authenticate(
        await accessTokenOf(validClaims()),
      ),
    );

    expect(error).not.toBeInstanceOf(IdentityRuleViolation);
  });

  it('audience が空の設定を、アクセストークンの規則違反に化けさせずに断る', async () => {
    // 規則5 / 7章末行: `aud` も同じで、空文字は `if (aud)` で照合そのものが省かれる。
    const error = await caughtError(
      authenticatorWithVerification({ audience: '' }).authenticate(
        await accessTokenOf(validClaims()),
      ),
    );

    expect(error).not.toBeInstanceOf(IdentityRuleViolation);
  });

  it('前後の空白を落として空になる設定も空として断る', async () => {
    // 規則5 / 境界: 空白だけの設定は照合が消えるのではなく「空白と一致しない」ので、
    // 包むと 401 に化ける。どちらに転んでも設定の不備であって、アクセストークンの
    // 規則違反ではない。
    const error = await caughtError(
      authenticatorWithVerification({ issuer: '   ' }).authenticate(
        await accessTokenOf(validClaims()),
      ),
    );

    expect(error).not.toBeInstanceOf(IdentityRuleViolation);
  });

  it('2度目の検証は鍵を取りに行かずに世帯を返す', async () => {
    // 規則6 / ADR-043 結果2: 鍵は最初の検証のときに1度だけ取り、保持したものを使い回す。
    // **戻り値も断定する** — 2度目が取りに行かずに落ちる実装でも callCount は 1 になり、
    // 回数だけでは空振りするためである。
    const fetchJwks = new FixedFetchJwks();
    const householdAuthenticator = authenticator(fetchJwks);
    const validAccessToken = await accessTokenOf(validClaims());

    await householdAuthenticator.authenticate(validAccessToken);
    const second = await householdAuthenticator.authenticate(validAccessToken);

    expect(second).toBe('11111111-1111-4111-8111-111111111111');
    expect(fetchJwks.callCount).toBe(1);
  });

  it('同時に走る2つの検証は、1度の取得を共に待って世帯を返す', async () => {
    // 規則6: 1度目の取得が終わる前に2度目が来ても、取りに行くのは1度である。
    // **await せずに2つ起動する** — 待ってから起動すると、直前のケースと同じ確認になる。
    const fetchJwks = new FixedFetchJwks();
    const householdAuthenticator = authenticator(fetchJwks);
    const validAccessToken = await accessTokenOf(validClaims());

    const [first, second] = await Promise.all([
      householdAuthenticator.authenticate(validAccessToken),
      householdAuthenticator.authenticate(validAccessToken),
    ]);

    expect(first).toBe('11111111-1111-4111-8111-111111111111');
    expect(second).toBe('11111111-1111-4111-8111-111111111111');
    expect(fetchJwks.callCount).toBe(1);
  });

  it('認証器を組んだだけでは鍵を取りに行かない', () => {
    // 規則6（「**最初の検証のときに**」）: 組んだ時点で取りに行くと、結線（B-09）が
    // 起動を JWKS の到達性に縛られる。
    const fetchJwks = new FixedFetchJwks();

    authenticator(fetchJwks);

    expect(fetchJwks.callCount).toBe(0);
  });

  it('応答が ok でないとき、届いた鍵を使わずに断る', async () => {
    // 規則7 / 7章: 届ける本体は**正しい鍵1件**なので、`ok` を見ているかどうかだけが
    // 結果を分ける。見ない実装は、エラー応答に載っていた鍵をそのまま使ってしまう。
    const error = await caughtError(
      authenticator(FixedFetchJwks.delivering({ ok: false, body: validJwksBody })).authenticate(
        await accessTokenOf(validClaims()),
      ),
    );

    expect(error).not.toBeInstanceOf(IdentityRuleViolation);
  });

  it('JWKS の keys が空の列のとき、アクセストークンの規則違反に化けさせずに断る', async () => {
    // 規則7・7c / ADR-002: 鍵が1本も無いのは取得の失敗であり、利用者が取り直しても直らない。
    // **空の判定は取得した本体に対して行う** — alg で絞った結果に対して行うと、
    // 1周目の「鍵の alg が違う」「鍵が alg を名乗らない」2件が赤に転じる。
    const error = await caughtError(
      authenticator(FixedFetchJwks.delivering({ ok: true, body: { keys: [] } })).authenticate(
        await accessTokenOf(validClaims()),
      ),
    );

    expect(error).not.toBeInstanceOf(IdentityRuleViolation);
  });

  it('JWKS の本体が keys を持たないとき、アクセストークンの規則違反に化けさせずに断る', async () => {
    // 規則7: 応答の形が違うのは取得の失敗である。**いまの実装でも緑になりうる**
    // （読めない本体は TypeError で落ちるため）が、規則6 で鍵を保持したあとも
    // 401 に化けないことを守るのはこの行であり、落とすと7章の列挙が無検査になる。
    const error = await caughtError(
      authenticator(FixedFetchJwks.delivering({ ok: true, body: {} })).authenticate(
        await accessTokenOf(validClaims()),
      ),
    );

    expect(error).not.toBeInstanceOf(IdentityRuleViolation);
  });

  it('JWKS の keys が配列でないとき、アクセストークンの規則違反に化けさせずに断る', async () => {
    // 規則7: 列として読めない `keys` も取得の失敗である（7章「応答が使えない」）。
    const error = await caughtError(
      authenticator(FixedFetchJwks.delivering({ ok: true, body: { keys: 'ES256' } })).authenticate(
        await accessTokenOf(validClaims()),
      ),
    );

    expect(error).not.toBeInstanceOf(IdentityRuleViolation);
  });

  it('JWKS の本体が読めないとき、アクセストークンの規則違反に化けさせずに断る', async () => {
    // 規則7: 本体が読めないのも取得の失敗である。アクセストークンは通るものを渡している
    // ので、断りの理由は応答だけに絞れている。
    const error = await caughtError(
      authenticator(FixedFetchJwks.delivering({ ok: true, unreadableBody: true })).authenticate(
        await accessTokenOf(validClaims()),
      ),
    );

    expect(error).not.toBeInstanceOf(IdentityRuleViolation);
  });

  it('JWKS を取りに行けないとき、その失敗をそのまま伝える', async () => {
    // 規則7・7b / 規則12 末行: 外から来た例外は包まずそのまま伝える。**同一のものが
    // 出ていくこと**まで断定する — 包み直すと api 層の写像を通って 401 に化け、
    // 5xx として出るという7章の約束が崩れる。
    const fetchFailure = new Error('JWKS の取得に失敗した');

    const error = await caughtError(
      authenticator(FixedFetchJwks.delivering({ throws: fetchFailure })).authenticate(
        await accessTokenOf(validClaims()),
      ),
    );

    expect(error).toBe(fetchFailure);
  });

  it('使えない応答を受け取った次の検証は、取り直して世帯を返す', async () => {
    // 規則7（「保持しない」）/ ADR-043 結果2: 使えない応答を覚えると、JWKS が直っても
    // インスタンスの寿命のあいだ断り続ける。保持してよいのは**成功した結果だけ**である。
    const householdAuthenticator = authenticator(
      FixedFetchJwks.delivering(
        { ok: false, body: validJwksBody },
        { ok: true, body: validJwksBody },
      ),
    );
    const validAccessToken = await accessTokenOf(validClaims());

    const error = await caughtError(householdAuthenticator.authenticate(validAccessToken));
    const second = await householdAuthenticator.authenticate(validAccessToken);

    expect(error).not.toBeInstanceOf(IdentityRuleViolation);
    expect(second).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('取りに行けなかった次の検証は、取り直して世帯を返す', async () => {
    // 規則7 / 規則6: 直前のケースとは経路が別である。取得を promise のまま保持する実装は
    // **拒否された promise を覚えたまま**にしうる。そのとき2度目は取り直せない。
    const fetchFailure = new Error('JWKS の取得に失敗した');
    const householdAuthenticator = authenticator(
      FixedFetchJwks.delivering({ throws: fetchFailure }, { ok: true, body: validJwksBody }),
    );
    const validAccessToken = await accessTokenOf(validClaims());

    const error = await caughtError(householdAuthenticator.authenticate(validAccessToken));
    const second = await householdAuthenticator.authenticate(validAccessToken);

    expect(error).toBe(fetchFailure);
    expect(second).toBe('11111111-1111-4111-8111-111111111111');
  });
});
