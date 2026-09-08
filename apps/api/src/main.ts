// composition root。
//
// **実装クラスを new してよいのはこのファイルだけである**（ADR-002 / CLAUDE.md）。
// ここでリポジトリとポートの実装を組み立て、ユースケースに注入し、api 層に渡す。
//
// いまはまだ組み立てるものがないので、疎通確認の経路だけを置いている。

import { Hono } from 'hono';

const app = new Hono();

/** 疎通確認。Supabase 無料プランの一時停止よけにも使える（ADR-020 の結果3）。 */
app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
