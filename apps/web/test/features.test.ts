import { afterEach, describe, expect, it, vi } from 'vitest';

const 環境変数名 = 'VITE_FEATURE_PANTRY_LIST';

/** 読み込み済みのものをそのまま読む。モジュールの再評価を起こさない。 */
async function フラグを読む() {
  return (await import('../src/features.js')).features;
}

/**
 * 値はモジュールの評価時に決まる（B-10 設計 規則4 / ADR-024 結果3）。
 * 環境変数を変えて確かめるには、読み込み直しが要る。
 */
async function フラグを読み直す() {
  vi.resetModules();
  return await フラグを読む();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('feature flag features', () => {
  it('VITE_FEATURE_PANTRY_LIST が true のとき在庫一覧のフラグは有効になる', async () => {
    vi.stubEnv(環境変数名, 'true');

    const features = await フラグを読み直す();

    expect(features.pantryList).toBe(true);
  });

  it('環境変数が未指定のとき在庫一覧のフラグは無効', async () => {
    // ADR-024 決定1・結果4: 指定を忘れた環境は「未完成が見えている」側に倒れない。
    vi.stubEnv(環境変数名, undefined);

    const features = await フラグを読み直す();

    expect(features.pantryList).toBe(false);
  });

  it('空文字列を渡してもフラグは有効にならない', async () => {
    // ADR-024 決定1: 有効なのは文字列 'true' と厳密一致するときだけ。
    vi.stubEnv(環境変数名, '');

    const features = await フラグを読み直す();

    expect(features.pantryList).toBe(false);
  });

  it('TRUE を true と見なさない', async () => {
    // ADR-024 決定1: 大文字小文字を吸収しない。
    vi.stubEnv(環境変数名, 'TRUE');

    const features = await フラグを読み直す();

    expect(features.pantryList).toBe(false);
  });

  it('1 を true と見なさない', async () => {
    // ADR-024 決定1: 真っぽい別表記を受け付けない。
    vi.stubEnv(環境変数名, '1');

    const features = await フラグを読み直す();

    expect(features.pantryList).toBe(false);
  });

  it('前後に空白のある true を true と見なさない', async () => {
    // ADR-024 決定1: 空白を落とさない。
    vi.stubEnv(環境変数名, ' true');

    const features = await フラグを読み直す();

    expect(features.pantryList).toBe(false);
  });

  it('false はフラグを無効にする', async () => {
    vi.stubEnv(環境変数名, 'false');

    const features = await フラグを読み直す();

    expect(features.pantryList).toBe(false);
  });

  it('読み込んだあとに環境変数を差し替えてもフラグの値は変わらない', async () => {
    // ADR-024 結果3: 値は読み込み時に1度だけ決まる。切り替えには再ビルドが要る。
    vi.stubEnv(環境変数名, 'true');
    await フラグを読み直す();

    vi.stubEnv(環境変数名, 'false');
    const features = await フラグを読む();

    expect(features.pantryList).toBe(true);
  });
});
