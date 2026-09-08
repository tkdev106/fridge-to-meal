#!/usr/bin/env node
// PreToolUse(Bash) のガード。
//
// 自律ループでは1コマンドずつ人が見ていない。取り返しのつかない操作だけを、
// 許可プロンプトではなく機械的な拒否で止める。判断の余地があるものは通す。
//
// 契約: stdin に PreToolUse の JSON。exit 0 で許可、exit 2 で拒否（stderr が
// エージェントに返り、次の手を考える材料になる）。
//
// ルールを足すときは「戻せない操作か」「trunk を壊すか」「秘密が漏れるか」の
// どれかに当たることを確認する。作業を細かく縛るためのルールは入れない。

import { execFileSync } from 'node:child_process';

const TRUNK = 'main';

/** @type {{ name: string, pattern: RegExp, message: string }[]} */
const RULES = [
  // ---- trunk を壊さない（docs/workflow.md） ----
  {
    name: 'force-push',
    pattern:
      /\bgit\b[^\n]*\bpush\b[^\n]*(--force(?!-with-lease|-if-includes)|(?<![\w-])-f(?![\w-])|\s\+refs)/,
    message:
      'force push は禁止です。短命ブランチの積み直しが必要なら --force-with-lease --force-if-includes を使ってください。',
  },
  {
    name: 'push-to-trunk',
    pattern: new RegExp(
      `\\bgit\\b[^\\n]*\\bpush\\b[^\\n]*(\\borigin\\s+(HEAD:)?${TRUNK}\\b|:${TRUNK}\\b)`,
    ),
    message: `${TRUNK} への直接 push は禁止です。短命ブランチを切って PR にしてください（docs/workflow.md）。`,
  },
  // ---- 戻せない操作 ----
  {
    name: 'reset-hard',
    pattern: /\bgit\b[^\n]*\breset\b[^\n]*--hard/,
    message:
      'git reset --hard は未コミットの変更を消します。git restore / git stash push を使うか、ユーザーに依頼してください。',
  },
  {
    name: 'clean-force',
    pattern: /\bgit\b[^\n]*\bclean\b[^\n]*-[a-zA-Z]*f/,
    message: 'git clean -f は追跡外ファイルを復元不能に消します。ユーザーに依頼してください。',
  },
  {
    name: 'branch-force-delete',
    pattern: /\bgit\b[^\n]*\bbranch\b[^\n]*(?<![\w-])-D(?![\w-])/,
    message:
      'git branch -D は未マージのコミットを捨てます。-d で消えないなら理由を報告してください。',
  },
  {
    name: 'stash-drop',
    pattern: /\bgit\b[^\n]*\bstash\b[^\n]*\b(drop|clear)\b/,
    message: 'git stash drop/clear は復元できません。ユーザーに依頼してください。',
  },
  {
    name: 'add-all',
    pattern: /\bgit\b[^\n]*\badd\b\s+(-A\b|--all\b|\.(\s|$))/,
    message:
      'git add -A / git add . は禁止です。コミットに入れるファイルを明示してください（意図しないファイルの混入を防ぐため）。',
  },
  // ---- 秘密を読ませない（NFR-10 / CLAUDE.md の環境変数の節） ----
  {
    name: 'secret-files',
    pattern:
      /(\.dev\.vars(\b|\.)|(^|[\s"'=/])\.env(?!\.example\b)(\.|\b)|\.ssh\/|\.aws\/|\.git-credentials|\.netrc|id_rsa|id_ed25519)/,
    message:
      '.dev.vars / .env / 資格情報ファイルへのアクセスは禁止です。値が必要ならユーザーに聞いてください（キーは会話にもコードにも残さない）。',
  },
  {
    name: 'env-dump',
    pattern: /(^|[;&|(]\s*)(env|printenv)(\s|$)/m,
    message:
      '環境変数の一覧表示は禁止です（SUPABASE_* や LLM のキーが会話に残るため）。必要な変数名をユーザーに聞いてください。',
  },
];

/**
 * ヒアドキュメントの中身を落とす。
 *
 * 本文はシェルに実行されないただのデータで、コミットメッセージや設定ファイルの
 * 生成に使われる。ここを検査に含めると「git add -A を禁止する」と書いた
 * コミットメッセージ自体が拒否される。リダイレクト先（`> .env` など）は
 * 開始行に残るので、検査からは漏れない。
 *
 * @param {string} command
 */
function stripHeredocs(command) {
  const lines = command.split('\n');
  const out = [];
  let marker = null;

  for (const line of lines) {
    if (marker === null) {
      out.push(line);
      const found = line.match(/<<[-~]?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
      if (found) marker = found[2];
      continue;
    }
    if (line.trim() === marker) marker = null;
  }

  return out.join('\n');
}

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

function deny(message) {
  process.stderr.write(`[guard] ${message}\n`);
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

const command = stripHeredocs(input?.tool_input?.command ?? '');
if (!command) process.exit(0);

for (const rule of RULES) {
  if (rule.pattern.test(command)) deny(rule.message);
}

// ブランチ名はコマンド文字列に出ないことがある（git push -u origin HEAD 等）ので、
// 実際の HEAD を見て trunk 上からの push を止める。
if (/\bgit\b[^\n]*\bpush\b/.test(command) && currentBranch(input?.cwd) === TRUNK) {
  deny(
    `${TRUNK} 上から push しようとしています。${TRUNK} は PR 経由でのみ更新します（docs/workflow.md）。`,
  );
}

process.exit(0);
