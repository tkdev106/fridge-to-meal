import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/** 禁止語（docs/domain-model.md 第3章 / ADR-018）。識別子にもコメントにも使わない。 */
const FORBIDDEN_TERMS = [
  'Recipe',
  'recipe',
  'Menu',
  'menu',
  'MealIdea',
  'レシピ',
  'メニュー',
  '候補',
  '料理',
  'ストック',
  'アイテム',
  'フード',
  '献立案',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/node_modules/**',
      'tools/**',
      '**/*.d.ts',
      // 並列で走るエージェントが作る git worktree。リポジトリの複製なので、
      // 検査すると同じ指摘が2度出るうえ、実行時間も倍になる
      '.claude/worktrees/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      // 型の解決の起点をこのファイルの場所に固定する。**省略すると、リポジトリの内側に
      // tsconfig.json を持つ別の木（エージェントの git worktree）があるときに
      // 「候補が複数ある」として全ファイルが parsing error になる。**
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // 用語表にない語をコードに書かない（CLAUDE.md の1つめの約束）。
      // 同義語の混在がこのプロジェクトで最も曖昧性を生むため、機械的に止める。
      'no-restricted-syntax': [
        'error',
        {
          selector: `Identifier[name=/(${FORBIDDEN_TERMS.filter((t) => /^[A-Za-z]/.test(t)).join('|')})/]`,
          message:
            '禁止語です。docs/domain-model.md 第3章の用語表にある語を使ってください（Recipe は将来の自前レシピ DB のために予約済み）。',
        },
      ],
    },
  },
  {
    // 設定ファイルは Node 環境
    files: ['*.config.{ts,js}', 'vitest.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // dependency-cruiser の設定は CommonJS
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    // フックは Node で直接実行される（バンドルも型チェックもしない）
    files: ['.claude/hooks/**/*.mjs', '.githooks/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
