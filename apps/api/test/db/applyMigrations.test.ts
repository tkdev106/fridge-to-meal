import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import applyMigrations from '../support/db/ApplyMigrations.js';
import { countUser, insertUser } from '../support/db/AuthUsers.js';
import { APP_CONNECTION_STRING } from '../support/db/ConnectionStrings.js';

/**
 * `pnpm test:db` の作り直し（`globalSetup`）を、移行を流し済みのデータベースにもう1度かける
 * （B-56d 設計書 規則12 / B-07d 規則1）。**`pnpm test:db` でだけ走る。**
 *
 * `globalSetup` は1回の実行で1度しか走らないので、「2度目に落ちない」「前回の利用者が残らない」は
 * ここで明示的にもう1度呼ばないと見えない。作り直すと他のファイルが置いた行も消えるが、各ファイルは
 * 自分の置いた行しか見ない（`fileParallelism: false` で同時には走らない）。
 *
 * 行を置く・数えるのは役を切り替える前の `authenticator`（設計書 規則11）。識別子は `b56d2000` で
 * 他のファイルと分ける。**後片付けはしない。**
 */

const leftoverUser = 'b56d2000-0010-4000-8000-000000000001';

const rowConnection = postgres(APP_CONNECTION_STRING, { max: 1 });

afterAll(async () => {
  await rowConnection.end();
});

describe('テスト用データベースの作り直し applyMigrations', () => {
  it('移行を流し済みのデータベースに作り直しをもう1度かけても失敗しない', async () => {
    // 設計書 規則12: `create schema private` が2回目に落ちないこと。
    await expect(applyMigrations()).resolves.toBeUndefined();
  });

  it('作り直すと、前に置いた利用者の行が残らない', async () => {
    await insertUser(rowConnection, leftoverUser);

    await applyMigrations();

    // 設計書 規則12: 前回の実行の利用者が残ると、識別子を固有にしても次の実行で衝突する。
    await expect(countUser(rowConnection, leftoverUser)).resolves.toBe(0);
  });
});
