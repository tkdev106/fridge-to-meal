#!/usr/bin/env node
// PreToolUse(Bash) のガード。
//
// 自律ループでは1コマンドずつ人が見ていない。取り返しのつかない操作だけを、
// 許可プロンプトではなく機械的な拒否で止める。判断の余地があるものは通す。
//
// 契約: stdin に PreToolUse の JSON。exit 0 で許可、exit 2 で拒否（stderr が
// エージェントに返り、次の手を考える材料になる）。
//
// 検査は次の順で行う。**この順序自体が誤検知と見落としの両方を減らしている。**
//   1. ヒアドキュメントとメッセージ引数を落とす — データであって実行されない
//   2. `;` `&&` `||` `|` 改行 で区切って、コマンドごとに見る
//   3. 各区切りをトークンに割り、語の位置で判定する（部分一致で拾わない）
//
// ルールを足すときは「戻せない操作か」「trunk を壊すか」「秘密が漏れるか」の
// どれかに当たることを確認する。作業を細かく縛るためのルールは入れない。

import { execFileSync } from 'node:child_process';

const TRUNK = 'main';

// ---------------------------------------------------------------- 前処理

/**
 * ヒアドキュメントの本文を落とす。
 *
 * 本文はシェルに実行されないデータで、コミットメッセージや設定ファイルの生成に
 * 使われる。検査に含めると「git add -A を禁止する」と書いたコミットメッセージ
 * 自体が拒否される。リダイレクト先（`> .env` など）は開始行に残るので漏れない。
 *
 * **終端が見つからないものは落とさない。** `echo "<< EOF"` のように引用符の中に
 * `<<` があるだけで、以降の全行が検査から消えてしまうため。
 *
 * @param {string} command
 */
function stripHeredocs(command) {
  const lines = command.split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const found = lines[i].match(/<<[-~]?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (!found) continue;

    const marker = found[2];
    const end = lines.findIndex((line, j) => j > i && line.trim() === marker);
    if (end === -1) continue; // 終端が無い = ヒアドキュメントではない

    i = end; // 本文と終端行を飛ばす
  }

  return out.join('\n');
}

/**
 * `-m` / `--message` に渡された文字列を落とす。
 *
 * コミットメッセージは実行されないデータである。ここを検査に含めると、
 * ガードの規則そのものに言及するコミット（このリポジトリでは普通に起きる）が
 * 書けなくなる。
 *
 * @param {string} command
 */
function stripMessageArgs(command) {
  return command
    .replace(/(^|\s)(-m|--message)(\s+|=)(['"])(?:\\.|(?!\4)[\s\S])*\4/g, '$1$2 ""')
    .replace(/(^|\s)(-m|--message)(\s+|=)[^\s'"]+/g, '$1$2 ""');
}

/** `;` `&&` `||` `|` 改行 で区切る。区切りごとに独立したコマンドとして見る。 */
function splitSegments(command) {
  return command
    .split(/\n|;|&&|\|\||\||\$\(|\)|`/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 先頭の環境変数代入（`VAR=x cmd`）を飛ばしてトークンに割る。 */
function tokenize(segment) {
  const tokens = segment.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  return tokens.slice(i);
}

const isFlag = (token) => token.startsWith('-');
/** 短縮フラグの束（`-uf` など）に指定の文字が含まれるか。 */
const hasShortFlag = (tokens, ch) =>
  tokens.some((t) => new RegExp(`^-[A-Za-z]*${ch}[A-Za-z]*$`).test(t));
const hasFlag = (tokens, ...names) => tokens.some((t) => names.includes(t));

/** git のサブコマンドを返す（`git -C dir push` のような大域オプションを飛ばす）。 */
function gitSubcommand(tokens) {
  if (tokens[0] !== 'git') return null;
  for (let i = 1; i < tokens.length; i++) {
    if (isFlag(tokens[i])) {
      if (tokens[i] === '-C' || tokens[i] === '-c') i++; // 値を取るもの
      continue;
    }
    return { name: tokens[i], args: tokens.slice(i + 1) };
  }
  return null;
}

/** 参照先が trunk かどうか。`main` `+main` `HEAD:main` `HEAD:refs/heads/main` を拾う。 */
function targetsTrunk(args) {
  return args
    .filter((a) => !isFlag(a))
    .some((a) => {
      const dest = a.replace(/^\+/, '').split(':').pop();
      return dest === TRUNK || dest === `refs/heads/${TRUNK}`;
    });
}

// ---------------------------------------------------------------- ルール

/** @type {{ name: string, test: (tokens: string[], segment: string) => boolean, message: string }[]} */
const RULES = [
  // ---- trunk を壊さない（docs/workflow.md） ----
  {
    name: 'force-push',
    test: (tokens) => {
      const git = gitSubcommand(tokens);
      if (git?.name !== 'push') return false;
      const forceFlag = git.args.some(
        (a) => a === '--force' || (isFlag(a) && !a.startsWith('--') && /^-[A-Za-z]*f/.test(a)),
      );
      const forceRefspec = git.args.some((a) => !isFlag(a) && a.startsWith('+'));
      return forceFlag || forceRefspec;
    },
    message:
      'force push は禁止です。作業ブランチの積み直しが必要なら --force-with-lease --force-if-includes を使ってください（refspec の + も force です）。',
  },
  {
    name: 'push-to-trunk',
    test: (tokens) => {
      const git = gitSubcommand(tokens);
      return git?.name === 'push' && targetsTrunk(git.args);
    },
    message: `${TRUNK} への直接 push は禁止です。作業ブランチを切って PR にしてください（docs/workflow.md）。`,
  },
  // ---- 戻せない操作 ----
  {
    name: 'reset-hard',
    test: (tokens) => {
      const git = gitSubcommand(tokens);
      return git?.name === 'reset' && hasFlag(git.args, '--hard');
    },
    message:
      'git reset --hard は未コミットの変更を消します。git restore / git stash push を使うか、ユーザーに依頼してください。',
  },
  {
    name: 'discard-changes',
    test: (tokens) => {
      const git = gitSubcommand(tokens);
      if (git?.name !== 'checkout' && git?.name !== 'switch') return false;
      return hasFlag(git.args, '--force', '--discard-changes') || hasShortFlag(git.args, 'f');
    },
    message:
      'git checkout/switch の --force は未コミットの変更を捨てます。先に git stash push で退避してください。',
  },
  {
    name: 'clean-force',
    test: (tokens) => {
      const git = gitSubcommand(tokens);
      return git?.name === 'clean' && (hasFlag(git.args, '--force') || hasShortFlag(git.args, 'f'));
    },
    message: 'git clean -f は追跡外ファイルを復元不能に消します。ユーザーに依頼してください。',
  },
  {
    name: 'branch-force',
    test: (tokens) => {
      const git = gitSubcommand(tokens);
      if (git?.name !== 'branch') return false;
      const forced = hasFlag(git.args, '--force') || hasShortFlag(git.args, 'f');
      const deleted = hasFlag(git.args, '--delete') || hasShortFlag(git.args, 'd');
      return hasShortFlag(git.args, 'D') || forced || (deleted && forced);
    },
    message:
      'git branch の -D / --force は未マージのコミットを捨てるか、ブランチ先端を付け替えます。-d で消えないなら理由を報告してください。',
  },
  {
    name: 'stash-drop',
    test: (tokens) => {
      const git = gitSubcommand(tokens);
      return git?.name === 'stash' && git.args.some((a) => a === 'drop' || a === 'clear');
    },
    message: 'git stash drop/clear は復元できません。ユーザーに依頼してください。',
  },
  {
    name: 'add-all',
    test: (tokens) => {
      const git = gitSubcommand(tokens);
      if (git?.name !== 'add') return false;
      if (
        hasFlag(git.args, '--all', '--update') ||
        hasShortFlag(git.args, 'A') ||
        hasShortFlag(git.args, 'u')
      )
        return true;
      return git.args.some((a) => !isFlag(a) && ['.', './', ':/', '*', '-'].includes(a));
    },
    message:
      'すべてを一括で stage するのは禁止です。コミットに入れるファイルを明示してください（意図しないファイルの混入を防ぐため）。',
  },
  // ---- 秘密を読ませない（NFR-10 / CLAUDE.md の環境変数の節） ----
  {
    name: 'secret-files',
    test: (_tokens, segment) =>
      /(\.dev\.vars(\b|\.)|\.dev\*|(^|[\s"'=/])\.env(?!\.example\b)(\.|\b|\*)|\.ssh(\/|\b)|\.aws(\/|\b)|\.git-credentials|\.netrc|id_rsa|id_ed25519)/.test(
        segment,
      ),
    message:
      '.dev.vars / .env / 資格情報ファイルへのアクセスは禁止です。値が必要ならユーザーに聞いてください（キーは会話にもコードにも残さない）。',
  },
  {
    name: 'env-dump',
    test: (tokens) => {
      if (tokens[0] === 'printenv') return true;
      // `env VAR=x cmd` は普通の実行。単独の env と、出力を渡す env だけを止める。
      return tokens[0] === 'env' && tokens.slice(1).every((t) => isFlag(t));
    },
    message:
      '環境変数の一覧表示は禁止です（SUPABASE_* や LLM のキーが会話に残るため）。必要な変数名をユーザーに聞いてください。',
  },
];

// ---------------------------------------------------------------- 実行

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function deny(name, message) {
  process.stderr.write(`[guard:${name}] ${message}\n`);
  process.exit(2);
}

const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (buf += chunk));
  process.stdin.on('end', () => resolve(buf));
});

let input;
try {
  input = JSON.parse(raw);
} catch {
  // フックの入力が読めないときに作業を止める理由はない
  process.exit(0);
}

const command = stripMessageArgs(stripHeredocs(input?.tool_input?.command ?? ''));
if (!command.trim()) process.exit(0);

for (const segment of splitSegments(command)) {
  const tokens = tokenize(segment);
  for (const rule of RULES) {
    if (rule.test(tokens, segment)) deny(rule.name, rule.message);
  }

  // 参照先がコマンドに出ない push（`git push` / `git push -u origin HEAD`）は、
  // 実際の HEAD を見て trunk 上からの push を止める。
  const git = gitSubcommand(tokens);
  if (git?.name === 'push' && currentBranch(input?.cwd) === TRUNK) {
    deny(
      'push-from-trunk',
      `${TRUNK} 上から push しようとしています。${TRUNK} は PR 経由でのみ更新します（docs/workflow.md）。`,
    );
  }
}

process.exit(0);
