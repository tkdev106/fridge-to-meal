import { sign } from 'hono/jwt';

/**
 * テスト用のアクセストークンを、ES256（P-256）の鍵対で署名して組む道具
 * （B-07g 設計書 4章・8章(c)）。
 *
 * **ここにある鍵対はテスト専用であり、実環境の鍵ではない。** 秘密鍵をリテラルで持てるのは、
 * この鍵で署名したアクセストークンがどこにも通用しないからである。
 *
 * `tsconfig.test.json` は `types: []` なので、テストからは `crypto` も `Response` も型が引けない
 * （設計書8章(c)）。そこで鍵は **JWK のリテラル**で固定し、署名は `hono/jwt` の `sign` に委ねる。
 * **鍵が `alg` を持つとき hono はヘッダーに `alg` と `kid` を載せる** — 検証側が `kid` で鍵を引く
 * （規則3）ための唯一の手である。
 */

/** 署名する中身。hono は型を輸出しないので引数から引く（設計書5章と同じ手）。 */
export type AccessTokenClaims = Parameters<typeof sign>[0];

/**
 * JWKS が届ける鍵の `kid`。アクセストークンのヘッダーの `kid` と一致する
 * （実環境もそうだった。設計書10章の実測）。
 *
 * **テストの中でヘッダーを base64url リテラルに差し替えるケースは、この値を焼き込んでいる。**
 * 変えるときは `HouseholdAuthenticatorImpl.test.ts` のヘッダーの literal も一緒に変える。
 */
export const accessTokenKeyId = '2c9a5e3f-0b7d-4a1e-9f6c-8d3b5a2e7c40';

/** JWKS が届けない `kid`。鍵が引けないこと（規則8）の確認に使う。 */
const unknownKeyId = '5f1d8c02-3a4b-4c5d-9e6f-7a8b9c0d1e2f';

/**
 * 公開鍵の本体。実環境の JWKS が届ける鍵と同じ項目を持たせている（設計書10章の実測）。
 * `alg` だけは、名乗るか名乗らないかを分けたいので下で足す（規則2b）。
 */
const publicKeyBody = {
  crv: 'P-256',
  ext: true,
  key_ops: ['verify'],
  kid: accessTokenKeyId,
  kty: 'EC',
  use: 'sig',
  x: 'Ky2fBl78ORF-suhY9aFs8Rf22RuRjpWYx5NNJxrcWaM',
  y: '8Ah199exunRkhbmw5tKdMotV5gMQRl3IttdFHVbQU8Q',
};

/** JWKS が届ける公開鍵。`alg: 'ES256'` と `kid` を名乗る（実環境の形）。 */
export const publicAccessTokenKey = { alg: 'ES256', ...publicKeyBody };

/** `alg` だけが設定と違う公開鍵。規則2b の確認に使う。 */
export const publicAccessTokenKeyWithOtherAlgorithm = { alg: 'ES384', ...publicKeyBody };

/**
 * `alg` を名乗らない公開鍵。規則2b の確認に使う。
 *
 * hono の照合は `if (matchingKey.alg && …)` であり、**この鍵は照合を素通りする。**
 * 渡す鍵を絞らない実装では、検証に使うアルゴリズムを決めるのがヘッダーの `alg` だけになる。
 */
export const publicAccessTokenKeyWithoutAlgorithm = { ...publicKeyBody };

/**
 * 秘密鍵の本体。**`key_ops` を載せない** — WebCrypto の `importKey` は要求する用途が `key_ops` の
 * 部分集合であることを求めるため、署名側に `verify` だけを載せると import が落ちる。
 */
const privateKeyBody = {
  crv: 'P-256',
  d: 'BTxJo6-yDr1Q9VNbWEXfIEahKoHttFtU616a3pbjAdU',
  kty: 'EC',
  x: 'Ky2fBl78ORF-suhY9aFs8Rf22RuRjpWYx5NNJxrcWaM',
  y: '8Ah199exunRkhbmw5tKdMotV5gMQRl3IttdFHVbQU8Q',
};

/** 公開鍵と対になる秘密鍵。`alg` と `kid` を名乗るので、ヘッダーにも両方が載る。 */
const privateAccessTokenKey = { alg: 'ES256', kid: accessTokenKeyId, ...privateKeyBody };

/** `kid` を名乗らない秘密鍵。署名したアクセストークンのヘッダーに `kid` が載らない。 */
const privateAccessTokenKeyWithoutKeyId = { alg: 'ES256', ...privateKeyBody };

/** JWKS が届けない `kid` を名乗る秘密鍵。鍵と対応の取れない `kid` になる。 */
const privateAccessTokenKeyWithUnknownKeyId = {
  alg: 'ES256',
  kid: unknownKeyId,
  ...privateKeyBody,
};

/** 与えた中身を、JWKS が届ける公開鍵と対になる秘密鍵で署名したアクセストークンにする。 */
export function accessTokenOf(claims: AccessTokenClaims): Promise<string> {
  return sign(claims, privateAccessTokenKey);
}

/** 与えた中身を、`kid` を名乗らない鍵で署名する（規則3 の確認に使う）。 */
export function accessTokenSignedWithoutKeyId(claims: AccessTokenClaims): Promise<string> {
  return sign(claims, privateAccessTokenKeyWithoutKeyId);
}

/** 与えた中身を、JWKS に無い `kid` を名乗る鍵で署名する（規則8 の確認に使う）。 */
export function accessTokenSignedWithUnknownKeyId(claims: AccessTokenClaims): Promise<string> {
  return sign(claims, privateAccessTokenKeyWithUnknownKeyId);
}
