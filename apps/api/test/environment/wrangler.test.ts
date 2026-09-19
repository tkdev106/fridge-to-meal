import { describe, expect, it } from 'vitest';
import { apiPackageJson, wranglerToml } from '../support/environment/EnvironmentFiles.js';
import { stripComments } from '../support/environment/StripComments.js';

/**
 * Workers の環境ファイルの守り（B-09 設計 規則12・13）。
 *
 * `wrangler.toml` は git 管理下にあるので、接続文字列と秘密を1つも書かないことを
 * ここで担保する。`package.json` は `dev` スクリプトが渡す**ローカル用の既定の接続先**が
 * 所有者ではなく `authenticator` であることを見る（ADR-029 決定3(b)）。
 *
 * 先行 `localPostgres.test.ts` と同じく `apps/api/test/db/**` の外に置く。Docker を要さず、
 * 見ているのはファイルの中身だけである（`docs/testing.md` 5章）。
 *
 * TOML はコメントを落としてから見る。落とさないと、コメントに書かれた
 * `binding = "HYPERDRIVE"` で根拠なく緑になり、コメントに書かれた `postgres://` で
 * 根拠なく赤になる。
 */
const wranglerContent = stripComments(wranglerToml ?? '', '#');

type ApiPackage = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const apiPackage = JSON.parse(apiPackageJson ?? '{}') as ApiPackage;
const devScript = apiPackage.scripts?.['dev'] ?? '';

function occurrencesOf(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

describe('wrangler.toml', () => {
  it('wrangler.toml は Hyperdrive の binding を1つだけ持つ', () => {
    // 規則12 / ADR-042 決定2・結果3: Workers から Postgres へは Hyperdrive 経由で繋ぐ。
    // binding が2つあると main.ts がどちらを読むか決まらない。
    expect(wranglerToml, 'apps/api/wrangler.toml が無い').not.toBeNull();

    expect(occurrencesOf(wranglerContent, '[[hyperdrive]]')).toBe(1);
  });

  it('Hyperdrive の binding 名は HYPERDRIVE である', () => {
    // 規則12 / ADR-042 決定2: main.ts は env.HYPERDRIVE.connectionString を読む。
    expect(wranglerContent).toContain('binding = "HYPERDRIVE"');
  });

  it('wrangler.toml は接続文字列を含まない', () => {
    // 規則12 / ADR-042 結果2: 接続情報は Hyperdrive の設定（Cloudflare 側）が持つ。
    // git 管理下のこのファイルに置くと、所有者ロールの接続文字列が漏れる道になる。
    expect(wranglerContent).not.toContain('postgres://');
    expect(wranglerContent).not.toContain('postgresql://');
  });

  it('wrangler.toml はパスワードを含まない', () => {
    // 規則12: 秘密を1つも書かない。
    expect(wranglerContent.toLowerCase()).not.toContain('password');
  });

  it('wrangler.toml は DATABASE_URL を含まない', () => {
    // 規則12・15 / ADR-042 決定2: 実行経路は DATABASE_URL を読まない。
    // db:generate（drizzle.config.ts）だけに残る変数を Workers の設定に持ち込まない。
    expect(wranglerContent).not.toContain('DATABASE_URL');
  });
});

describe('apps/api/package.json', () => {
  it('postgres は api の dependencies にあり devDependencies には無い', () => {
    // 設計書2章・9章: main.ts が postgres を import する。devDependencies のままだと
    // 配信物に載らず、結線した瞬間に実行時だけで落ちる。依存の追加ではなく移動である。
    expect(apiPackageJson, 'apps/api/package.json が無い').not.toBeNull();

    expect(typeof apiPackage.dependencies?.['postgres']).toBe('string');
    expect(apiPackage.devDependencies ?? {}).not.toHaveProperty('postgres');
  });

  it('dev スクリプトは CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE が外から無ければ既定を与える', () => {
    // 規則13 / ADR-042 結果3: binding を置くと wrangler dev がローカル用の接続文字列を要求する。
    // 既定を与えないと pnpm dev が止まる。名は CLOUDFLARE_… — wrangler 4.129 は
    // WRANGLER_… を非推奨にした。POSIX の既定値展開（${NAME:-既定}）で外からの値を優先する。
    expect(devScript).toContain('${CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:-');
  });

  it('dev の既定の接続文字列はローカル Postgres の authenticator を指す', () => {
    // 規則13 / ADR-029 決定3(b) / ADR-030 決定1: test/support/db/ConnectionStrings.ts の
    // APP_CONNECTION_STRING と同じ役・同じ 127.0.0.1:55432。
    expect(devScript).toContain('authenticator:authenticator@127.0.0.1:55432');
  });

  it('dev の既定の接続文字列は所有者 postgres を渡さない', () => {
    // 規則13 / ADR-029 決定3(b): 所有者は行レベルセキュリティを素通りする。
    // 手元の pnpm dev が所有者で動くと、世帯の分離（C-9）が無くても気づけない。
    expect(devScript).not.toContain('postgres:postgres@');
  });
});
