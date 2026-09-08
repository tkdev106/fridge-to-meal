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

/**
 * git が渡す形で1行を作る。
 * @param {string} remoteRef push 先の参照
 * @param {string} [remoteSha] 削除のときは 0 が並ぶ
 */
const line = (remoteRef, remoteSha = 'b384b2f') =>
  `refs/heads/local 9d2176b ${remoteRef} ${remoteSha}\n`;

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
  const { status } = run(line('refs/heads/main', '0000000000000000000000000000000000000000'));
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

test('許可: 名前が main で始まるだけのブランチ', () => {
  const { status, stderr } = run(line('refs/heads/maintenance'));
  assert.equal(status, 0, stderr);
});

test('許可: 作業ブランチの削除', () => {
  const { status, stderr } = run(
    line('refs/heads/feat/x', '0000000000000000000000000000000000000000'),
  );
  assert.equal(status, 0, stderr);
});

test('許可: push する参照が無い', () => {
  const { status, stderr } = run('');
  assert.equal(status, 0, stderr);
});
