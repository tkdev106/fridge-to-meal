import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ドメイン層とユースケース層のテストが主。実 DB・実 API を使わない（ADR-002）。
    // **`.tsx` も拾う。** 画面の出し分け（`docs/testing.md` 4章の「表示の分岐」）は
    // コンポーネントを描いてからでないと観察できない。描く回は各ファイルの先頭で
    // `// @vitest-environment jsdom` を宣言する — 既定を node のままにしておくと、
    // ドメイン層とユースケース層の多数派が jsdom の起動ぶんだけ遅くならない（同 5章）。
    include: ['apps/**/test/**/*.test.{ts,tsx}', 'apps/**/src/**/*.test.{ts,tsx}'],
    // Docker のローカル Postgres に繋ぐテストは `pnpm test:db`（vitest.db.config.ts）だけが
    // 走らせる。分け方は置き場で決める（B-07d 設計 規則8 / ADR-029 決定4）。
    // **configDefaults.exclude を残す** — 上書きすると node_modules まで走査してしまう。
    exclude: [...configDefaults.exclude, 'apps/api/test/db/**'],
    environment: 'node',
    // **書体の一覧と global.css だけは css の中身を読ませる**（B-59b）。既定（`include: []`）の
    // vitest は css を処理せず、`?raw` で読んでも空文字になるため、書体の一覧の検査
    // （`apps/web/test/fonts/`）が中身を見られない。他の css まで処理させると描くテストが
    // 遅くなるので、当てるのはこの2枚に限る。
    css: { include: [/apps\/web\/public\/fonts\/fonts\.css/, /apps\/web\/src\/global\.css/] },
    coverage: {
      include: ['apps/api/src/contexts/*/domain/**', 'apps/api/src/contexts/*/usecase/**'],
    },
  },
});
