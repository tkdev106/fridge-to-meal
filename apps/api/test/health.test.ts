import { describe, expect, it } from 'vitest';
import app from '../src/main.js';

describe('疎通確認', () => {
  it('GET /health が ok を返す', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });
});
