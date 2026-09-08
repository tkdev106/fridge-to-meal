import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ドメイン層とユースケース層のテストが主。実 DB・実 API を使わない（ADR-002）。
    include: ['apps/**/test/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['apps/api/src/contexts/*/domain/**', 'apps/api/src/contexts/*/usecase/**'],
    },
  },
});
