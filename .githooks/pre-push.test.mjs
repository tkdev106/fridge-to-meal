// pre-push フックの回帰テスト。
//
//   pnpm test:hooks
//
// このフックは main を守る最後の一枚である（GitHub のブランチ保護がこのプランでは
// 効かない）。黙って効かなくなると、trunk が壊れるまで誰も気づかない。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'pre-push');

const ZERO = '0000000000000000000000000000000000000000';

/**
 * git が渡す形で1行を作る。
 *
 * **削除は「送る側」が 0 の並びになる**（`(delete) 0000… <remote ref> <remote sha>`）。
 * 受け取る側が 0 の並びなのは削除ではなく、**まだリモートに無い枝の最初の push** である。
 * 取り違えると「初回 push だけ検査を素通りする」フックになる。
 *
 * @param {string} remoteRef push 先の参照
 * @param {string} [remoteSha] リモートの現在の先端。初回 push では 0 が並ぶ
 */
const line = (remoteRef, remoteSha = 'b384b2f') =>
  `refs/heads/local 9d2176b ${remoteRef} ${remoteSha}\n`;

/** 参照の削除。送る側が 0 の並びになる。 */
const deleteLine = (remoteRef) => `(delete) ${ZERO} ${remoteRef} b384b2f\n`;

/** @param {string} input */
function run(input) {
  const result = spawnSync(HOOK, ['origin', 'https://github.com/tkdev106/fridge-to-meal'], {
    input,
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr };
}

test('拒否: main への push', () => {
  const { status, stderr } = run(line('refs/heads/main'));
  assert.equal(status, 1);
  assert.match(stderr, /pre-push: main への直接 push は禁止です/);
});

test('拒否: main の削除', () => {
  const { status } = run(deleteLine('refs/heads/main'));
  assert.equal(status, 1);
});

test('拒否: 複数の参照のうち1つが main', () => {
  const { status } = run(line('refs/heads/feat/x') + line('refs/heads/main'));
  assert.equal(status, 1);
});

test('許可: 作業ブランチへの push', () => {
  const { status, stderr } = run(line('refs/heads/feat/pantry-stock-item'));
  assert.equal(status, 0, stderr);
});

test('拒否: 名前が main で始まるだけのブランチ（trunk の規則ではなく名前の規則で）', () => {
  // trunk の判定は完全一致であり、前方一致で拾っていない。それを、拒否の**理由**で確かめる —
  // `maintenance` は `<type>/<slug>` でないため、いまはブランチ名の規則が断る。
  const { status, stderr } = run(line('refs/heads/maintenance'));
  assert.equal(status, 1);
  assert.match(stderr, /<type>\/<slug> の形にしてください/);
  assert.doesNotMatch(stderr, /main への直接 push/);
});

test('許可: 作業ブランチの削除は名前を見ない', () => {
  // 後片付けを止める理由がない。名前の規則に反する枝も消せること。
  const { status, stderr } = run(deleteLine('refs/heads/feat/x'));
  assert.equal(status, 0, stderr);
});

test('拒否: 初回 push でも名前を検査する', () => {
  // リモートに無い枝（受け取る側が 0 の並び）は最初の push であって削除ではない。
  const { status, stderr } = run(line('refs/heads/claude/b-08-from-2d5wji', ZERO));
  assert.equal(status, 1);
  assert.match(stderr, /名前に claude を入れないでください/);
});

test('拒否: タスクの番号だけのブランチ名', () => {
  const { status, stderr } = run(line('refs/heads/feat/b-08'));
  assert.equal(status, 1);
  assert.match(stderr, /slug に変更の内容がありません/);
});

test('拒否: 生成された識別子を含むブランチ名', () => {
  const { status, stderr } = run(line('refs/heads/feat/pantry-routes-2d5wji'));
  assert.equal(status, 1);
  assert.match(stderr, /名前から読めません/);
});

test('許可: 番号と内容の両方があるブランチ名', () => {
  const { status, stderr } = run(line('refs/heads/feat/b-08-stock-item-routes'));
  assert.equal(status, 0, stderr);
});

test('許可: 機能追加以外の type', () => {
  const { status, stderr } = run(line('refs/heads/refactor/household-transaction-move'));
  assert.equal(status, 0, stderr);
});

test('許可: タグの push は名前を見ない', () => {
  const { status, stderr } = run(`refs/tags/v0.1.0 9d2176b refs/tags/v0.1.0 ${ZERO}\n`);
  assert.equal(status, 0, stderr);
});

test('許可: push する参照が無い', () => {
  const { status, stderr } = run('');
  assert.equal(status, 0, stderr);
});
