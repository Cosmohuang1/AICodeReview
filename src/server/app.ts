import express from 'express';
import { webhookHandler } from './webhook.handler.js';

const app = express();

// 使用 raw body（保留原始 Buffer 用于 HMAC 验证）
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

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
