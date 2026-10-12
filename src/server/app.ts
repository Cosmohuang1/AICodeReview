import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { webhookHandler } from './webhook.handler.js';
import { apiRouter } from './api.routes.js';

const app = express();

// 静态资源服务 (Web 控制台)
app.use(express.static(path.join(process.cwd(), 'public')));

// 使用 raw body（保留原始 Buffer 用于 HMAC 验证）
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// API 路由
app.use('/api', apiRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

app.post('/webhook', webhookHandler);

const PORT = parseInt(process.env.PORT ?? '3000', 10);
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[ai-review] Server listening on port ${PORT}`);
  });
}

export { app };
export default app;
