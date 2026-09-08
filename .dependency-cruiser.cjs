/**
 * 依存ルールの機械的な検査。
 *
 * **規則は `docs/adr.md` A章の表と1対1で対応する。** 表を変えたらここも変える。
 * 逆に、ここを緩めて表を放置しない。文書とコードが食い違ったら、まず文書を読む。
 *
 *   pnpm lint:deps
 */
module.exports = {
  forbidden: [
    // ---- 層の依存: 外から内への一方向だけ（ADR-001） ----
    {
      name: 'domain-は何もimportしない',
      comment:
        'domain/ は usecase / infrastructure / api を import してはならない。' +
        'ドメイン層のソースに DB・HTTP・LLM の都合が1行も現れないことが、ADR-002 の依存関係逆転の実体である。',
      severity: 'error',
      from: { path: '^apps/api/src/contexts/[^/]+/domain/' },
      to: { path: '^apps/api/src/contexts/[^/]+/(usecase|infrastructure|api)/' },
    },
    {
      name: 'usecase-はinfraとapiをimportしない',
      comment:
        'usecase/ が触れてよいのは domain/ だけ。実装クラスは composition root から注入される。',
      severity: 'error',
      from: { path: '^apps/api/src/contexts/[^/]+/usecase/' },
      to: { path: '^apps/api/src/contexts/[^/]+/(infrastructure|api)/' },
    },
    {
      name: 'infrastructure-はusecaseとapiをimportしない',
      comment: 'infrastructure/ は domain/ の interface を実装するだけ。ユースケースを呼ばない。',
      severity: 'error',
      from: { path: '^apps/api/src/contexts/[^/]+/infrastructure/' },
      to: { path: '^apps/api/src/contexts/[^/]+/(usecase|api)/' },
    },
    {
      name: 'api-はdomainとinfraをimportしない',
      comment:
        'api/ が呼んでよいのは usecase/ だけ。ドメインの型を HTTP 層に露出させない（ADR-003）。' +
        'やりとりするのは DTO である。',
      severity: 'error',
      from: { path: '^apps/api/src/contexts/[^/]+/api/' },
      to: { path: '^apps/api/src/contexts/[^/]+/(domain|infrastructure)/' },
    },

    // ---- コンテキストをまたぐ依存（ADR-004 / ADR-013） ----
    {
      name: 'コンテキストをまたぐのはusecaseどうしだけ',
      comment:
        '相手コンテキストの domain / infrastructure / api を直接 import しない。' +
        '公開されたユースケース経由に限る。境界がコンパイルエラーにならないぶん、ここで守る。',
      severity: 'error',
      from: { path: '^apps/api/src/contexts/([^/]+)/' },
      to: {
        path: '^apps/api/src/contexts/([^/]+)/(domain|infrastructure|api)/',
        pathNot: '^apps/api/src/contexts/$1/',
      },
    },

    // ---- 実装の生成場所（CLAUDE.md） ----
    {
      name: 'infraの実装をmain以外から名指ししない',
      comment:
        'infrastructure/ の実装クラスを import してよいのは composition root（main.ts）だけ。' +
        '他所で new すると、差し替え可能にした意味がなくなる。',
      severity: 'error',
      from: {
        path: '^apps/api/src/',
        pathNot: '^apps/api/src/(main\\.ts$|contexts/[^/]+/infrastructure/)',
      },
      to: { path: '^apps/api/src/contexts/[^/]+/infrastructure/' },
    },

    // ---- web と api の境界（ADR-003） ----
    {
      name: 'webはapiの中身をimportしない',
      comment:
        'web は API のクライアントであり、特権的な近道を持たない。' +
        '共有してよいのは packages/contract の DTO だけ。',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^apps/api/' },
    },
    {
      name: 'contractはアプリをimportしない',
      comment: '型定義の置き場であり、実装に依存しない。',
      severity: 'error',
      from: { path: '^packages/contract/' },
      to: { path: '^apps/' },
    },

    // ---- 一般的な健全性 ----
    {
      name: '循環参照を作らない',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: '存在しないモジュールを参照しない',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist|\\.gitkeep)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'types', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
