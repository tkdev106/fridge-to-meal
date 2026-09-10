import { afterEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'hono/jwt';
import { HouseholdAuthenticatorImpl } from '../../../../src/contexts/identity/infrastructure/HouseholdAuthenticatorImpl.js';
import type { AccessTokenVerification } from '../../../../src/contexts/identity/infrastructure/HouseholdAuthenticatorImpl.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';

/** 設定に与える共有秘密。値そのものはテストの本題ではない。 */
const 共有秘密 = 'kyouyuu-himitsu-no-tesuto-you-no-atai';

const 我が家 = '11111111-1111-4111-8111-111111111111';

type クレーム = Parameters<typeof sign>[0];

/** 実時刻からの固定オフセットで秒を置く。`exp` / `nbf` / `iat` の本題は前後関係だけである。 */
function 実時刻から(秒: number): number {
  return Math.floor(Date.now() / 1000) + 秒;
}

/** 署名・期限・`sub` のどれも通る中身。本題のクレームだけを重ねて使う（`docs/testing.md` 6章）。 */
function 通る中身(): クレーム {
  return { sub: 我が家, exp: 実時刻から(3600) };
}

/** 与えた中身を、設定と同じ共有秘密・同じアルゴリズムで署名した資格にする。 */
function 資格(中身: クレーム): Promise<string> {
  return sign(中身, 共有秘密, 'HS256');
}

/** 設定を1つ組む。本題でない項は既定のままにする。 */
function 認証器(overrides: Partial<AccessTokenVerification> = {}) {
  return new HouseholdAuthenticatorImpl({
    sharedSecret: 共有秘密,
    algorithm: 'HS256',
    ...overrides,
  });
}

/** 投げられた例外そのものを取り出す。**中身を見るのは規則8 と7章末行のときだけ。** */
async function 捕まえた例外(実行: Promise<unknown>): Promise<Error> {
  try {
    await 実行;
  } catch (投げられたもの) {
    return 投げられたもの as Error;
  }
  throw new Error('例外が投げられなかった');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('世帯認証器 HouseholdAuthenticatorImpl', () => {
  it('署名・アルゴリズム・期限・sub がすべて通る資格から、sub を世帯の識別子として返す', async () => {
    // 規則1・4 / ADR-028: 4つすべてが通ったときだけ、sub をそのまま世帯の識別子とする。
    const 結果 = await 認証器().authenticate(await 資格(通る中身()));

    expect(結果).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('sub の前後の空白を落とした値を世帯とする', async () => {
    // 規則4: 落とした結果を世帯とする。空のクレームは0行に化けて黙る（ADR-029 理由(1)）。
    const 結果 = await 認証器().authenticate(
      await 資格({ ...通る中身(), sub: '  11111111-1111-4111-8111-111111111111  ' }),
    );

    expect(結果).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('前後に空白の付いた資格を、空白を落として検証する', async () => {
    // 規則9: 資格の正規化は腐敗防止層の仕事であり、ユースケースは加工せずに渡してくる。
    const 通る資格 = await 資格(通る中身());

    const 結果 = await 認証器().authenticate(` ${通る資格} `);

    expect(結果).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('issuer を設定に与えたとき、iss が一致する資格を通す', async () => {
    // 規則6: 与えられていれば照合する。
    const 結果 = await 認証器({ issuer: 'https://ninshou.example/auth/v1' }).authenticate(
      await 資格({ ...通る中身(), iss: 'https://ninshou.example/auth/v1' }),
    );

    expect(結果).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('issuer を設定に与えたとき、iss が違う資格を accessToken.invalid で断る', async () => {
    // 規則6 / 7章2行目: 別の発行者が署名した資格で世帯を名乗らせない。
    const 実行 = 認証器({ issuer: 'https://ninshou.example/auth/v1' }).authenticate(
      await 資格({ ...通る中身(), iss: 'https://hoka.example' }),
    );

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('issuer を設定に与えていなければ、どんな iss を名乗る資格も iss では断らない', async () => {
    // 規則6: 何を与えるかを決めるのは結線（B-09）であって、この層ではない。
    const 結果 = await 認証器().authenticate(
      await 資格({ ...通る中身(), iss: 'https://hoka.example' }),
    );

    expect(結果).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('audience を設定に与えたとき、aud が一致する資格を通す', async () => {
    // 規則6: 与えられていれば照合する。
    const 結果 = await 認証器({ audience: 'authenticated' }).authenticate(
      await 資格({ ...通る中身(), aud: 'authenticated' }),
    );

    expect(結果).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('audience を設定に与えたとき、aud が違う資格を accessToken.invalid で断る', async () => {
    // 規則6 / 7章2行目: 別の宛先に発行された資格を使い回させない。
    const 実行 = 認証器({ audience: 'authenticated' }).authenticate(
      await 資格({ ...通る中身(), aud: 'hoka' }),
    );

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('audience を設定に与えたとき、aud を持たない資格を accessToken.invalid で断る', async () => {
    // 規則6・11: 通る中身は aud を持たない。照合すると決めた以上、無い資格も通さない。
    const 実行 = 認証器({ audience: 'authenticated' }).authenticate(await 資格(通る中身()));

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('audience を設定に与えていなければ、どんな aud を名乗る資格も aud では断らない', async () => {
    // 規則6: 照合しないと決めた項で断らない。
    const 結果 = await 認証器().authenticate(await 資格({ ...通る中身(), aud: 'hoka' }));

    expect(結果).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('設定と違う共有秘密で署名された資格を accessToken.invalid で断る', async () => {
    // 規則1 / ADR-029 結果2: 署名を検証せずにクレームを張ることは、なりすましを許すのと同じ。
    const 実行 = 認証器().authenticate(await sign(通る中身(), 'betsu-no-kyouyuu-himitsu', 'HS256'));

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('ヘッダーが設定と違うアルゴリズムを名乗る資格を accessToken.invalid で断る', async () => {
    // 規則2 / ADR-031 決定2: 期待するアルゴリズムは設定で固定し、ヘッダーを信用しない。
    const 実行 = 認証器().authenticate(await sign(通る中身(), 共有秘密, 'HS512'));

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('alg に none を名乗り署名部が空の資格を accessToken.invalid で断る', async () => {
    // 規則2: なりすましの経路そのもの。署名を捨てた資格を通したら検証は無かったことになる。
    // ヘッダーは base64url にした `{"alg":"none","typ":"JWT"}`、署名部は空にして自分で組む。
    const [, 中身の部分 = ''] = (await 資格(通る中身())).split('.');
    const 署名を捨てた資格 = `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${中身の部分}.`;

    const 実行 = 認証器().authenticate(署名を捨てた資格);

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('3つの部分に分かれていない文字列を accessToken.invalid で断る', async () => {
    // 規則1 / 7章2行目: 形式不正も同じ断り方に写す。
    const 実行 = 認証器().authenticate('kore-wa-token-de-nai');

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('exp を持たない資格を accessToken.invalid で断る', async () => {
    // 規則3: hono は exp があるときだけ検証するため、無い資格は素通りする。
    // 無期限の資格を通すと失効の手段が消える。
    const 実行 = 認証器().authenticate(await 資格({ sub: 我が家 }));

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('exp が過ぎた資格を accessToken.expired で断る', async () => {
    // 規則1 / 7章3行目: 取り直せば回復する失敗なので、回復しないものと区別する。
    const 実行 = 認証器().authenticate(await 資格({ ...通る中身(), exp: 実時刻から(-3600) }));

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.expired' });
  });

  it('nbf がまだ来ていない資格を accessToken.invalid で断る', async () => {
    // 規則11: JwtTokenExpired 以外の Jwt 例外はまとめて accessToken.invalid に写す。
    const 実行 = 認証器().authenticate(
      await 資格({ sub: 我が家, nbf: 実時刻から(3600), exp: 実時刻から(7200) }),
    );

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('iat が未来の資格を accessToken.invalid で断る', async () => {
    // 規則11 / 7章4行目: 写さないと hono の JwtTokenIssuedAt が腐敗防止層の外へ漏れる。
    const 実行 = 認証器().authenticate(
      await 資格({ sub: 我が家, iat: 実時刻から(3600), exp: 実時刻から(7200) }),
    );

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.invalid' });
  });

  it('sub を持たない資格を accessToken.subjectMissing で断る', async () => {
    // 規則4 / 7章5行目: 世帯を定められない資格から HouseholdId を作らない。
    const 実行 = 認証器().authenticate(await 資格({ exp: 実時刻から(3600) }));

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.subjectMissing' });
  });

  it('sub が文字列でない資格を accessToken.subjectMissing で断る', async () => {
    // 規則4: hono は sub を見ないので通す。文字列であることはこの層が確かめる。
    const 実行 = 認証器().authenticate(await 資格({ ...通る中身(), sub: 42 }));

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.subjectMissing' });
  });

  it('sub が空文字の資格を accessToken.subjectMissing で断る', async () => {
    // 規則4 / ADR-029 理由(1): 空の世帯を張ると、例外ではなく0行になって黙る。
    const 実行 = 認証器().authenticate(await 資格({ ...通る中身(), sub: '' }));

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.subjectMissing' });
  });

  it('sub が空白だけの資格を accessToken.subjectMissing で断る', async () => {
    // 規則4: 前後の空白を落とした結果が空でないことまでを見る。
    const 実行 = 認証器().authenticate(await 資格({ ...通る中身(), sub: ' \t ' }));

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.subjectMissing' });
  });

  it('期限切れで断るとき、例外の message に資格の文字列を載せない', async () => {
    // 規則8: hono の例外は message にトークンを含む（`token (…) expired`）ので包み直して捨てる。
    const 期限切れの資格 = await 資格({ ...通る中身(), exp: 実時刻から(-3600) });

    const 例外 = await 捕まえた例外(認証器().authenticate(期限切れの資格));

    expect(例外.message).not.toContain(期限切れの資格);
  });

  it('aud が無くて断るとき、例外の message に sub の値を載せない', async () => {
    // 規則8: クレームの中身も message に載せない。
    const 例外 = await 捕まえた例外(
      認証器({ audience: 'authenticated' }).authenticate(await 資格(通る中身())),
    );

    expect(例外.message).not.toContain('11111111-1111-4111-8111-111111111111');
  });

  it('一度通った資格でも、期限を跨いだ2度目は accessToken.expired で断る', async () => {
    // 規則10: 成否をキャッシュすると、規則3の期限が効かなくなる。
    const 通る資格 = await 資格(通る中身());
    const 世帯認証器 = 認証器();

    const 一度目 = await 世帯認証器.authenticate(通る資格);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 7200 * 1000));
    const 二度目 = 世帯認証器.authenticate(通る資格);

    expect(一度目).toBe('11111111-1111-4111-8111-111111111111');
    await expect(二度目).rejects.toThrow(IdentityRuleViolation);
    await expect(二度目).rejects.toMatchObject({ rule: 'accessToken.expired' });
  });

  it('検証以前に失敗する設定のときは、IdentityRuleViolation に包まずそのまま伝える', async () => {
    // 7章末行 / ADR-002: 写せない失敗を握りつぶさない。共有秘密が渡っていないのは設定の誤りである。
    const 例外 = await 捕まえた例外(
      認証器({ sharedSecret: '' }).authenticate(await 資格(通る中身())),
    );

    expect(例外).not.toBeInstanceOf(IdentityRuleViolation);
  });
});
