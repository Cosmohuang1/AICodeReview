import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { webhookHandler } from './webhook.handler.js';
import { apiRouter } from './api.routes.js';

const app = express();

// CORS 跨域支持 (支持本地开发与多端调用)
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (_req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// 静态资源服务 (Web 控制台)
app.use(express.static(path.join(process.cwd(), 'public')));

// 使用 raw body（保留原始 Buffer 用于 HMAC 验证）
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// API 路由
app.use('/api', apiRouter);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

app.post('/webhook', webhookHandler);

// API 404 处理
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// 全局统一错误捕获中间件 (防止进程崩溃)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ai-review] 全局未捕获异常:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = parseInt(process.env.PORT ?? '3000', 10);
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[ai-review] Server listening on port ${PORT}`);
  });
}

export { app };
export default app;
