import { describe, expect, it } from 'vitest';
import { identifyHousehold } from '../../../../src/contexts/identity/usecase/IdentifyHousehold.js';
import { IdentityRuleViolation } from '../../../../src/contexts/identity/domain/error/IdentityRuleViolation.js';
import { householdIdOf } from '../../../../src/shared/domain/HouseholdId.js';
import type { 認証器の応答 } from '../../../support/identity/FixedHouseholdAuthenticator.js';
import { 記憶上の世帯認証器 } from '../../../support/identity/FixedHouseholdAuthenticator.js';

const 我が家 = householdIdOf('11111111-1111-4111-8111-111111111111');

/** 本題でないアクセストークンの中身を隠す（`docs/testing.md` 6章）。空でありさえしなければよい。 */
const 通るアクセストークン = 'ヘッダー.本体.署名';

/**
 * 認証器を記憶上の実装で組み、ユースケースを1つ作る。応答は呼ばれる順に渡す。
 */
function 準備(...応答たち: readonly 認証器の応答[]) {
  const householdAuthenticator = new 記憶上の世帯認証器(...応答たち);
  const 世帯を定める = identifyHousehold({ householdAuthenticator });

  return { householdAuthenticator, 世帯を定める };
}

/** 検証以前の失敗（設定の誤りなど）を表す、この経路の外から来る例外。 */
class 設定の誤り extends Error {}

describe('世帯を定める IdentifyHousehold', () => {
  it('アクセストークンが通ったときは、認証器が定めた世帯の識別子だけを返す', async () => {
    // 規則1・5 / ドメインモデル2章: 返すのは世帯の識別子1つで、他のクレームは持ち出さない。
    const { 世帯を定める } = 準備({ 返す世帯: 我が家 });

    const 結果 = await 世帯を定める(通るアクセストークン);

    expect(結果).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('空文字のアクセストークンを accessToken.missing で断る', async () => {
    // 規則9・7 / 7章1行目 / ADR-025: 失敗の区別は rule の識別子で表す。
    const { 世帯を定める } = 準備({ 返す世帯: 我が家 });

    const 実行 = 世帯を定める('');

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.missing' });
  });

  it('空白だけのアクセストークンを accessToken.missing で断る', async () => {
    // 規則9 / 7章1行目: 断る判定にだけ前後の空白を落とす。
    const { 世帯を定める } = 準備({ 返す世帯: 我が家 });

    const 実行 = 世帯を定める(' \t\n ');

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.missing' });
  });

  it('空のアクセストークンのときは、認証器に問い合わせない', async () => {
    // 規則9 / NFR-09: 検証器に空を渡して結果を推測しない。
    const { householdAuthenticator, 世帯を定める } = 準備({ 返す世帯: 我が家 });

    await expect(世帯を定める('')).rejects.toThrow(IdentityRuleViolation);

    expect(householdAuthenticator.呼ばれた回数).toBe(0);
  });

  it('空白を含んでいても空でないアクセストークンは断らず、認証器に委ねた結果を返す', async () => {
    // 規則9: 空かどうかだけがユースケースの判定であり、アクセストークンの形は見ない。
    const { 世帯を定める } = 準備({ 返す世帯: 我が家 });

    const 結果 = await 世帯を定める(' abc ');

    expect(結果).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('認証器には、受け取ったアクセストークンを前後の空白ごとそのまま渡す', async () => {
    // 規則9: アクセストークンの正規化は腐敗防止層の仕事。ユースケースが黙って加工しない。
    const { householdAuthenticator, 世帯を定める } = 準備({ 返す世帯: 我が家 });

    await 世帯を定める(' abc ');

    expect(householdAuthenticator.受け取ったアクセストークン).toBe(' abc ');
  });

  it('認証器が断ったときは、その IdentityRuleViolation を型も rule も変えずに伝える', async () => {
    // 7章末行 / 規則7 / 11章 / ADR-003: 包み直しても状態コードにも写さない。
    const { 世帯を定める } = 準備({
      投げる例外: new IdentityRuleViolation('accessToken.expired', '期限が切れている'),
    });

    const 実行 = 世帯を定める(通るアクセストークン);

    await expect(実行).rejects.toThrow(IdentityRuleViolation);
    await expect(実行).rejects.toMatchObject({ rule: 'accessToken.expired' });
  });

  it('認証器が IdentityRuleViolation 以外の例外を投げたときは、包まずそのまま伝える', async () => {
    // 7章末行 / ADR-002: 写せない失敗を握りつぶさない。
    const { 世帯を定める } = 準備({ 投げる例外: new 設定の誤り('鍵が渡っていない') });

    await expect(世帯を定める(通るアクセストークン)).rejects.toThrow(設定の誤り);
  });

  it('一度通ったアクセストークンでも、2度目は改めて認証器に委ねる', async () => {
    // 規則10: 成否をキャッシュすると、規則3の期限が効かなくなる。
    const { 世帯を定める } = 準備(
      { 返す世帯: 我が家 },
      { 投げる例外: new IdentityRuleViolation('accessToken.expired', '期限が切れている') },
    );

    const 一度目 = await 世帯を定める(通るアクセストークン);
    const 二度目 = 世帯を定める(通るアクセストークン);

    expect(一度目).toBe('11111111-1111-4111-8111-111111111111');
    await expect(二度目).rejects.toThrow(IdentityRuleViolation);
    await expect(二度目).rejects.toMatchObject({ rule: 'accessToken.expired' });
  });
});
