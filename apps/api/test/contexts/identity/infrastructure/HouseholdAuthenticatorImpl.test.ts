import { afterEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'hono/jwt';
import { HouseholdAuthenticatorImpl } from '../../../../src/contexts/identity/infrastructure/HouseholdAuthenticatorImpl.js';
import type { AccessTokenVerification } from '../../../../src/contexts/identity/infrastructure/HouseholdAuthenticatorImpl.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';

/** 設定に与える共有秘密。値そのものはテストの本題ではない。 */
const sharedSecret = 'kyouyuu-himitsu-no-tesuto-you-no-atai';

const ourHousehold = '11111111-1111-4111-8111-111111111111';

type Claims = Parameters<typeof sign>[0];

/** 実時刻からの固定オフセットで秒を置く。`exp` / `nbf` / `iat` の本題は前後関係だけである。 */
function secondsFromNow(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

/** 署名・期限・`sub` のどれも通る中身。本題のクレームだけを重ねて使う（`docs/testing.md` 6章）。 */
function validClaims(): Claims {
  return { sub: ourHousehold, exp: secondsFromNow(3600) };
}

/** 与えた中身を、設定と同じ共有秘密・同じアルゴリズムで署名したアクセストークンにする。 */
function accessTokenOf(claims: Claims): Promise<string> {
  return sign(claims, sharedSecret, 'HS256');
}

/** 設定を1つ組む。本題でない項は既定のままにする。 */
function authenticator(overrides: Partial<AccessTokenVerification> = {}) {
  return new HouseholdAuthenticatorImpl({
    sharedSecret,
    algorithm: 'HS256',
    ...overrides,
  });
}

/** 投げられた例外そのものを取り出す。**中身を見るのは規則8 と7章末行のときだけ。** */
async function caughtError(execution: Promise<unknown>): Promise<Error> {
  try {
    await execution;
  } catch (thrown) {
    return thrown as Error;
  }
  throw new Error('例外が投げられなかった');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('世帯認証器 HouseholdAuthenticatorImpl', () => {
  it('署名・アルゴリズム・期限・sub がすべて通るアクセストークンから、sub を世帯の識別子として返す', async () => {
    // 規則1・4 / ADR-028: 4つすべてが通ったときだけ、sub をそのまま世帯の識別子とする。
    const result = await authenticator().authenticate(await accessTokenOf(validClaims()));

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('sub の前後の空白を落とした値を世帯とする', async () => {
    // 規則4: 落とした結果を世帯とする。空のクレームは0行に化けて黙る（ADR-029 理由(1)）。
    const result = await authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), sub: '  11111111-1111-4111-8111-111111111111  ' }),
    );

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('前後に空白の付いたアクセストークンを、空白を落として検証する', async () => {
    // 規則9: アクセストークンの正規化は腐敗防止層の仕事であり、ユースケースは加工せずに渡してくる。
    const validAccessToken = await accessTokenOf(validClaims());

    const result = await authenticator().authenticate(` ${validAccessToken} `);

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('issuer を設定に与えたとき、iss が一致するアクセストークンを通す', async () => {
    // 規則6: 与えられていれば照合する。
    const result = await authenticator({ issuer: 'https://ninshou.example/auth/v1' }).authenticate(
      await accessTokenOf({ ...validClaims(), iss: 'https://ninshou.example/auth/v1' }),
    );

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('issuer を設定に与えたとき、iss が違うアクセストークンを accessToken.invalid で断る', async () => {
    // 規則6 / 7章2行目: 別の発行者が署名したアクセストークンで世帯を名乗らせない。
    const execution = authenticator({ issuer: 'https://ninshou.example/auth/v1' }).authenticate(
      await accessTokenOf({ ...validClaims(), iss: 'https://hoka.example' }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('issuer を設定に与えていなければ、どんな iss を名乗るアクセストークンも iss では断らない', async () => {
    // 規則6: 何を与えるかを決めるのは結線（B-09）であって、この層ではない。
    const result = await authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), iss: 'https://hoka.example' }),
    );

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('audience を設定に与えたとき、aud が一致するアクセストークンを通す', async () => {
    // 規則6: 与えられていれば照合する。
    const result = await authenticator({ audience: 'authenticated' }).authenticate(
      await accessTokenOf({ ...validClaims(), aud: 'authenticated' }),
    );

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('audience を設定に与えたとき、aud が違うアクセストークンを accessToken.invalid で断る', async () => {
    // 規則6 / 7章2行目: 別の宛先に発行されたアクセストークンを使い回させない。
    const execution = authenticator({ audience: 'authenticated' }).authenticate(
      await accessTokenOf({ ...validClaims(), aud: 'hoka' }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('audience を設定に与えたとき、aud を持たないアクセストークンを accessToken.invalid で断る', async () => {
    // 規則6・11: 通る中身は aud を持たない。照合すると決めた以上、無いアクセストークンも通さない。
    const execution = authenticator({ audience: 'authenticated' }).authenticate(
      await accessTokenOf(validClaims()),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('audience を設定に与えていなければ、どんな aud を名乗るアクセストークンも aud では断らない', async () => {
    // 規則6: 照合しないと決めた項で断らない。
    const result = await authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), aud: 'hoka' }),
    );

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('設定と違う共有秘密で署名されたアクセストークンを accessToken.invalid で断る', async () => {
    // 規則1 / ADR-029 結果2: 署名を検証せずにクレームを張ることは、なりすましを許すのと同じ。
    const execution = authenticator().authenticate(
      await sign(validClaims(), 'betsu-no-kyouyuu-himitsu', 'HS256'),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('ヘッダーが設定と違うアルゴリズムを名乗るアクセストークンを accessToken.invalid で断る', async () => {
    // 規則2 / ADR-031 決定2: 期待するアルゴリズムは設定で固定し、ヘッダーを信用しない。
    const execution = authenticator().authenticate(
      await sign(validClaims(), sharedSecret, 'HS512'),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('alg に none を名乗り署名部が空のアクセストークンを accessToken.invalid で断る', async () => {
    // 規則2: なりすましの経路そのもの。署名を捨てたアクセストークンを通したら検証は無かったことになる。
    // ヘッダーは base64url にした `{"alg":"none","typ":"JWT"}`、署名部は空にして自分で組む。
    const [, payloadPart = ''] = (await accessTokenOf(validClaims())).split('.');
    const unsignedAccessToken = `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${payloadPart}.`;

    const execution = authenticator().authenticate(unsignedAccessToken);

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('3つの部分に分かれていない文字列を accessToken.invalid で断る', async () => {
    // 規則1 / 7章2行目: 形式不正も同じ断り方に写す。
    const execution = authenticator().authenticate('kore-wa-token-de-nai');

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('exp を持たないアクセストークンを accessToken.invalid で断る', async () => {
    // 規則3: hono は exp があるときだけ検証するため、無いアクセストークンは素通りする。
    // 無期限のアクセストークンを通すと失効の手段が消える。
    const execution = authenticator().authenticate(await accessTokenOf({ sub: ourHousehold }));

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('exp が過ぎたアクセストークンを accessToken.expired で断る', async () => {
    // 規則1 / 7章3行目: 取り直せば回復する失敗なので、回復しないものと区別する。
    const execution = authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), exp: secondsFromNow(-3600) }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.expired' });
  });

  it('nbf がまだ来ていないアクセストークンを accessToken.invalid で断る', async () => {
    // 規則11: JwtTokenExpired 以外の Jwt 例外はまとめて accessToken.invalid に写す。
    const execution = authenticator().authenticate(
      await accessTokenOf({
        sub: ourHousehold,
        nbf: secondsFromNow(3600),
        exp: secondsFromNow(7200),
      }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('iat が未来のアクセストークンを accessToken.invalid で断る', async () => {
    // 規則11 / 7章4行目: 写さないと hono の JwtTokenIssuedAt が腐敗防止層の外へ漏れる。
    const execution = authenticator().authenticate(
      await accessTokenOf({
        sub: ourHousehold,
        iat: secondsFromNow(3600),
        exp: secondsFromNow(7200),
      }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('sub を持たないアクセストークンを accessToken.subjectMissing で断る', async () => {
    // 規則4 / 7章5行目: 世帯を定められないアクセストークンから HouseholdId を作らない。
    const execution = authenticator().authenticate(
      await accessTokenOf({ exp: secondsFromNow(3600) }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.subjectMissing' });
  });

  it('sub が文字列でないアクセストークンを accessToken.subjectMissing で断る', async () => {
    // 規則4: hono は sub を見ないので通す。文字列であることはこの層が確かめる。
    const execution = authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), sub: 42 }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.subjectMissing' });
  });

  it('sub が空文字のアクセストークンを accessToken.subjectMissing で断る', async () => {
    // 規則4 / ADR-029 理由(1): 空の世帯を張ると、例外ではなく0行になって黙る。
    const execution = authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), sub: '' }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.subjectMissing' });
  });

  it('sub が空白だけのアクセストークンを accessToken.subjectMissing で断る', async () => {
    // 規則4: 前後の空白を落とした結果が空でないことまでを見る。
    const execution = authenticator().authenticate(
      await accessTokenOf({ ...validClaims(), sub: ' \t ' }),
    );

    await expect(execution).rejects.toThrow(IdentityRuleViolation);
    await expect(execution).rejects.toMatchObject({ rule: 'accessToken.subjectMissing' });
  });

  it('期限切れで断るとき、例外の message にアクセストークンの文字列を載せない', async () => {
    // 規則8: hono の例外は message にトークンを含む（`token (…) expired`）ので包み直して捨てる。
    const expiredAccessToken = await accessTokenOf({
      ...validClaims(),
      exp: secondsFromNow(-3600),
    });

    const error = await caughtError(authenticator().authenticate(expiredAccessToken));

    expect(error.message).not.toContain(expiredAccessToken);
  });

  it('aud が無くて断るとき、例外の message に sub の値を載せない', async () => {
    // 規則8: クレームの中身も message に載せない。
    const error = await caughtError(
      authenticator({ audience: 'authenticated' }).authenticate(await accessTokenOf(validClaims())),
    );

    expect(error.message).not.toContain('11111111-1111-4111-8111-111111111111');
  });

  it('一度通ったアクセストークンでも、期限を跨いだ2度目は accessToken.expired で断る', async () => {
    // 規則10: 成否をキャッシュすると、規則3の期限が効かなくなる。
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

  it('検証以前に失敗する設定のときは、IdentityRuleViolation に包まずそのまま伝える', async () => {
    // 7章末行 / ADR-002: 写せない失敗を握りつぶさない。共有秘密が渡っていないのは設定の誤りである。
    const error = await caughtError(
      authenticator({ sharedSecret: '' }).authenticate(await accessTokenOf(validClaims())),
    );

    expect(error).not.toBeInstanceOf(IdentityRuleViolation);
  });
});
