// guard.mjs の回帰テスト。
//
//   pnpm test:hooks
//
// ガードが黙って効かなくなるのが一番まずい（自律ループでは誰も見ていない）ので、
// 拒否するはずのコマンドと、通すはずのコマンドの両方を固定する。
// 拒否側は**どのルールで拒否されたか**まで見る — 別のルールがたまたま拾って
// 緑になると、死んだルールに気づけないため。
// テストのコマンド文字列そのものがガードに引っかかるため、シェル経由では書けない。
//
// cwd には git 管理外の一時ディレクトリを渡す。リポジトリ自身を渡すと、
// **テストを走らせているブランチによって結果が変わる**（main 上では push が
// 拒否され、CI の main への push で落ちる）。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'guard.mjs');

/** git 管理外。currentBranch が空を返すので、ブランチ判定が結果に混ざらない */
const OUTSIDE_GIT = mkdtempSync(join(tmpdir(), 'guard-nogit-'));
/** ブランチ名 main の空リポジトリ。ブランチ判定そのものを固定するために使う */
let ON_TRUNK;

before(() => {
  ON_TRUNK = mkdtempSync(join(tmpdir(), 'guard-trunk-'));
  spawnSync('git', ['init', '-b', 'main', ON_TRUNK], { encoding: 'utf8' });
});

after(() => {
  rmSync(OUTSIDE_GIT, { recursive: true, force: true });
  if (ON_TRUNK) rmSync(ON_TRUNK, { recursive: true, force: true });
});

/** @param {string} command @param {string} [cwd] */
function run(command, cwd = OUTSIDE_GIT) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { command }, cwd }),
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr };
}

/** [ケース名, コマンド, 拒否するルール名] */
const DENIED = [
  ['force push', 'git push --force origin feat/x', 'force-push'],
  ['force push の短縮形', 'git push -f origin feat/x', 'force-push'],
  ['短縮フラグの束', 'git push -uf origin feat/x', 'force-push'],
  ['refspec の +', 'git push origin +feat/x', 'force-push'],
  ['trunk への push', 'git push origin main', 'push-to-trunk'],
  ['trunk への push（refspec）', 'git push origin HEAD:main', 'push-to-trunk'],
  ['trunk への push（完全形）', 'git push origin HEAD:refs/heads/main', 'push-to-trunk'],
  ['trunk への push（origin 以外）', 'git push upstream main', 'push-to-trunk'],
  ['trunk への force push', 'git push origin +main', 'force-push'],
  [
    'trunk への lease つき force push',
    'git push --force-with-lease origin HEAD:refs/heads/main',
    'push-to-trunk',
  ],
  ['大域オプション付き', 'git -C /repo push origin main', 'push-to-trunk'],
  ['reset --hard', 'git reset --hard HEAD~1', 'reset-hard'],
  ['checkout --force', 'git checkout -f main', 'discard-changes'],
  ['switch --discard-changes', 'git switch --discard-changes main', 'discard-changes'],
  ['clean -fd', 'git clean -fd', 'clean-force'],
  ['branch -D', 'git branch -D feat/x', 'branch-force'],
  ['branch --delete --force', 'git branch --delete --force feat/x', 'branch-force'],
  ['branch -f による付け替え', 'git branch -f main HEAD~5', 'branch-force'],
  ['stash drop', 'git stash drop', 'stash-drop'],
  ['add -A', 'git add -A', 'add-all'],
  ['add .', 'git add .', 'add-all'],
  ['add ./', 'git add ./', 'add-all'],
  ['add :/', 'git add :/', 'add-all'],
  ['add *', 'git add *', 'add-all'],
  ['add -u', 'git add -u', 'add-all'],
  ['フラグを挟んだ add -A', 'git add -v -A', 'add-all'],
  ['.dev.vars の読み出し', 'cat apps/api/.dev.vars', 'secret-files'],
  ['.dev* のグロブ', 'cat apps/api/.dev*', 'secret-files'],
  ['.env の読み出し', 'cat .env', 'secret-files'],
  ['.env.local の読み出し', 'cat apps/web/.env.local', 'secret-files'],
  ['ssh 鍵の読み出し', 'cat ~/.ssh/id_ed25519', 'secret-files'],
  ['ssh ディレクトリの一覧', 'ls ~/.ssh', 'secret-files'],
  ['環境変数のダンプ', 'printenv', 'env-dump'],
  ['パイプに渡すダンプ', 'printenv|grep SUPABASE', 'env-dump'],
  ['コマンド置換の中のダンプ', 'echo $(env)', 'env-dump'],
  ['複合コマンドの後段', 'pnpm test && git push --force origin feat/x', 'force-push'],
  [
    'ヒアドキュメントの外にある危険な操作',
    "git commit -F - << 'MSG'\nメッセージ\nMSG\ngit push --force origin feat/x",
    'force-push',
  ],
  ['ヒアドキュメントで .env を作る', "cat > .env << 'EOF'\nSUPABASE_URL=x\nEOF", 'secret-files'],
  ['終端の無い << に隠した操作', 'echo "<< EOF"\ngit push --force origin main', 'force-push'],
  // ---- ブランチ名（docs/workflow.md 1章）----
  ['名前に claude', 'git switch -c claude/b-08-from-2d5wji', 'branch-name'],
  ['名前に Claude（大文字混じり）', 'git switch -c feat/Claude-routes', 'branch-name'],
  ['type が無い', 'git switch -c pantry-routes', 'branch-name'],
  ['知らない type', 'git switch -c wip/pantry-routes', 'branch-name'],
  ['タスクの番号だけ', 'git switch -c feat/b-08', 'branch-name'],
  ['1文字の slug', 'git switch -c feat/x', 'branch-name'],
  ['生成された識別子', 'git switch -c feat/pantry-routes-2d5wji', 'branch-name'],
  ['大文字の slug', 'git switch -c feat/PantryRoutes', 'branch-name'],
  ['連続するハイフン', 'git switch -c feat/pantry--routes', 'branch-name'],
  ['checkout -b でも同じ', 'git checkout -b claude/x-1', 'branch-name'],
  ['checkout -B でも同じ', 'git checkout -B feat/b-08', 'branch-name'],
  ['branch で直に作る', 'git branch feat/b-08', 'branch-name'],
  ['branch -m による改名', 'git branch -m feat/oops-2d5wji', 'branch-name'],
  ['branch -m の新しい名前を見る', 'git branch -m feat/pantry-routes claude/x-1', 'branch-name'],
];

/** [ケース名, コマンド] */
const ALLOWED = [
  ['検証コマンド', 'pnpm verify'],
  ['個別の検証', 'pnpm lint && pnpm typecheck && pnpm test'],
  ['作業ブランチへの push', 'git push -u origin feat/pantry-stock-item'],
  ['積み直し（lease つき）', 'git push --force-with-lease --force-if-includes origin feat/x'],
  ['ファイルを明示した add', 'git add apps/api/src/main.ts'],
  ['紛らわしいが通すべき add', 'git add .gitignore'],
  ['branch -d', 'git branch -d feat/x'],
  ['restore', 'git restore apps/api/src/main.ts'],
  ['ブランチの切り替え', 'git switch main && git pull --ff-only'],
  ['stash push / pop', 'git stash push && git stash pop'],
  ['.env.example', 'cat .env.example'],
  ['env による一時的な環境変数', 'env NODE_ENV=test pnpm test'],
  ['前置の環境変数', 'VITE_FEATURE_PANTRY_LIST=true pnpm --filter @fridge-to-meal/web dev'],
  ['git 以外の clean', 'git log --oneline && pnpm clean --force'],
  ['ルールに言及するコミット（-m）', 'git commit -m "chore: git add -A を禁止する"'],
  ['ルールに言及するコミット（.env）', 'git commit -m "docs: .env の扱いを書く"'],
  [
    'ルールに言及するコミット（ヒアドキュメント）',
    "git commit -F - << 'MSG'\nchore: git add -A を禁止する\n\ngit push --force も止める\nMSG",
  ],
  // ---- ブランチ名: 通すべき側（docs/workflow.md 1章）----
  ['内容のわかる枝を切る', 'git switch -c feat/pantry-stock-item-routes'],
  ['番号と内容の両方', 'git switch -c feat/b-08-stock-item-routes'],
  ['短い語でも内容があれば通す', 'git switch -c docs/adr'],
  ['数字を含む語', 'git switch -c chore/node-22-upgrade'],
  ['機能追加以外の type', 'git switch -c refactor/household-transaction-move'],
  ['既存の枝への切り替え（名前を見ない）', 'git switch feat/x'],
  ['枝の削除（名前を見ない）', 'git branch -d feat/x'],
  ['枝の一覧', 'git branch --list'],
  ['ブランチ名に言及するコミット', 'git commit -m "chore: claude/ 始まりのブランチ名を禁止する"'],
];

for (const [name, command, rule] of DENIED) {
  test(`拒否: ${name}`, () => {
    const { status, stderr } = run(command);
    assert.equal(status, 2, `通ってしまった: ${command}`);
    assert.match(stderr, new RegExp(`^\\[guard:${rule}\\] `), `別のルールが拾っている: ${stderr}`);
  });
}

for (const [name, command] of ALLOWED) {
  test(`許可: ${name}`, () => {
    const { status, stderr } = run(command);
    assert.equal(status, 0, `拒否された: ${command} / ${stderr}`);
  });
}

test('拒否: trunk 上からの push（参照先がコマンドに出ない）', () => {
  const { status, stderr } = run('git push -u origin HEAD', ON_TRUNK);
  assert.equal(status, 2);
  assert.match(stderr, /^\[guard:push-from-trunk\] /);
});

test('拒否: trunk 上からの push（リモート名だけ）', () => {
  const { status, stderr } = run('git push origin', ON_TRUNK);
  assert.equal(status, 2);
  assert.match(stderr, /^\[guard:push-from-trunk\] /);
});

test('許可: trunk 上からのマージ済み枝の削除', () => {
  // 枝の後片付けは main に居るときに行う。trunk を更新しないので止める理由がない
  const { status, stderr } = run('git push origin --delete feat/x', ON_TRUNK);
  assert.equal(status, 0, stderr);
});

test('許可: trunk 上から作業ブランチを明示して push', () => {
  const { status, stderr } = run('git push origin feat/x', ON_TRUNK);
  assert.equal(status, 0, stderr);
});

test('拒否: trunk 上から trunk を明示して push', () => {
  const { status, stderr } = run('git push origin main', ON_TRUNK);
  assert.equal(status, 2);
  assert.match(stderr, /^\[guard:push-to-trunk\] /);
});

test('許可: 作業ブランチ上からの同じ push', () => {
  spawnSync('git', ['-C', ON_TRUNK, 'switch', '-c', 'feat/x'], { encoding: 'utf8' });
  const { status, stderr } = run('git push -u origin HEAD', ON_TRUNK);
  spawnSync('git', ['-C', ON_TRUNK, 'switch', 'main'], { encoding: 'utf8' });
  assert.equal(status, 0, stderr);
});

test('入力が JSON でなくても作業を止めない', () => {
  const result = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
});
