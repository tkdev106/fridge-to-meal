// guard.mjs の回帰テスト。
//
//   node --test .claude/hooks
//
// ガードが黙って効かなくなるのが一番まずい（自律ループでは誰も見ていない）ので、
// 拒否するはずのコマンドと、通すはずのコマンドの両方を固定する。
// テストのコマンド文字列そのものがガードに引っかかるため、シェル経由では書けない。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'guard.mjs');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @param {string} command @param {string} [cwd] */
function run(command, cwd = REPO) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { command }, cwd }),
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr };
}

const DENIED = [
  ['force push', 'git push --force origin feat/x'],
  ['force push の短縮形', 'git push -f origin feat/x'],
  ['trunk への push', 'git push origin main'],
  ['trunk への push（refspec）', 'git push origin HEAD:main'],
  ['reset --hard', 'git reset --hard HEAD~1'],
  ['clean -fd', 'git clean -fd'],
  ['branch -D', 'git branch -D feat/x'],
  ['stash drop', 'git stash drop'],
  ['add -A', 'git add -A'],
  ['add .', 'git add .'],
  ['.dev.vars の読み出し', 'cat apps/api/.dev.vars'],
  ['.env の読み出し', 'cat .env'],
  ['ssh 鍵の読み出し', 'cat ~/.ssh/id_ed25519'],
  ['環境変数のダンプ', 'printenv'],
  ['複合コマンドの後段', 'pnpm test && git push --force origin feat/x'],
  [
    'ヒアドキュメントの外にある危険な操作',
    "git commit -F - << 'MSG'\nメッセージ\nMSG\ngit push --force origin feat/x",
  ],
  ['ヒアドキュメントで .env を作る', "cat > .env << 'EOF'\nSUPABASE_URL=x\nEOF"],
];

const ALLOWED = [
  ['検証コマンド', 'pnpm lint && pnpm typecheck && pnpm test'],
  ['短命ブランチへの push', 'git push -u origin feat/pantry-stock-item'],
  ['積み直し（lease つき）', 'git push --force-with-lease --force-if-includes origin feat/x'],
  ['ファイルを明示した add', 'git add apps/api/src/main.ts'],
  ['branch -d', 'git branch -d feat/x'],
  ['restore', 'git restore apps/api/src/main.ts'],
  ['.env.example', 'cat .env.example'],
  ['trunk への切り替え', 'git switch main && git pull --ff-only'],
  [
    'ルールに言及するコミットメッセージ',
    "git commit -F - << 'MSG'\nchore: git add -A を禁止する\n\ngit push --force も止める\nMSG",
  ],
];

for (const [name, command] of DENIED) {
  test(`拒否: ${name}`, () => {
    const { status, stderr } = run(command);
    assert.equal(status, 2, `通ってしまった: ${command}`);
    assert.match(stderr, /^\[guard\] /);
  });
}

for (const [name, command] of ALLOWED) {
  test(`許可: ${name}`, () => {
    const { status, stderr } = run(command);
    assert.equal(status, 0, `拒否された: ${command} / ${stderr}`);
  });
}

test('入力が JSON でなくても作業を止めない', () => {
  const result = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
});
