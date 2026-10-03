import { describe, expect, it } from 'vitest';
import {
  describeFailure,
  logUnexpectedFailure,
} from '../../../src/shared/api/UnexpectedFailureLog.js';

/** DB ドライバの問い合わせの失敗の形。`message` に SQL と束縛した値を入れる（drizzle-orm の実装と同じ）。 */
class DrizzleQueryError extends Error {
  constructor(query: string, params: readonly unknown[], cause: Error) {
    super(`Failed query: ${query}\nparams: ${params.join(',')}`, { cause });
    this.name = 'DrizzleQueryError';
  }
}

class PostgresError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PostgresError';
  }
}

describe('describeFailure', () => {
  it('素の Error は種類とメッセージを載せる（自前の例外は名前しか載せない規律で書かれている）', () => {
    expect(describeFailure(new Error('献立の生成の設定 GEMINI_API_KEY が空です'))).toBe(
      'Error: 献立の生成の設定 GEMINI_API_KEY が空です',
    );
  });

  it('DB ドライバの問い合わせの失敗は、メッセージの SQL と束縛した値を載せない', () => {
    const thrown = new DrizzleQueryError(
      'insert into stock_items (household_id, name) values ($1, $2)',
      ['b72a1000-0001-4000-8000-000000000001', 'たまねぎ'],
      new PostgresError('connection refused', 'ECONNREFUSED'),
    );

    const described = describeFailure(thrown);

    expect(described).not.toContain('b72a1000-0001-4000-8000-000000000001');
    expect(described).not.toContain('たまねぎ');
    expect(described).not.toContain('insert into');
  });

  it('DB ドライバの問い合わせの失敗は、原因の種類とコードだけを載せる', () => {
    const thrown = new DrizzleQueryError(
      'select 1',
      [],
      new PostgresError('password authentication failed', '28P01'),
    );

    expect(describeFailure(thrown)).toBe('DrizzleQueryError cause=PostgresError code=28P01');
  });

  it('原因に文字列のコードが無ければ、原因の種類だけを載せる', () => {
    const thrown = new DrizzleQueryError('select 1', [], new TypeError('fetch failed'));

    expect(describeFailure(thrown)).toBe('DrizzleQueryError cause=TypeError');
  });

  it('原因が Error でなければ、原因の型の名前だけを載せる', () => {
    const thrown = new DrizzleQueryError('select 1', [], new Error('x'));
    Object.defineProperty(thrown, 'cause', { value: 'どこかの文字列' });

    expect(describeFailure(thrown)).toBe('DrizzleQueryError cause=string');
  });

  it('Error でない値は型の名前だけを載せる', () => {
    expect(describeFailure('世帯 b72a1000 の在庫')).toBe('string');
  });
});

describe('logUnexpectedFailure', () => {
  it('経路が分かる接頭辞を付けた1行を書く', () => {
    const lines: string[] = [];

    logUnexpectedFailure(new Error('設定が空です'), (line) => lines.push(line));

    expect(lines).toEqual(['api.unexpected Error: 設定が空です']);
  });
});
