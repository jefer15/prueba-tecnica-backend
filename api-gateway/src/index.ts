import express                  from 'express';
import axios                    from 'axios';
import { loggingMiddleware }    from './middleware/logging.middleware';
import { authMiddleware }       from './middleware/auth.middleware';
import { rateLimitMiddleware }  from './middleware/rate-limit.middleware';
import { proxyMiddleware } from './proxy/proxy.middleware';

const app = express();
app.use(express.json());
app.use(loggingMiddleware);

app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    service:   'api-gateway',
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

const PAYMENT_SERVICE_URL      = process.env.PAYMENT_SERVICE_URL      ?? 'http://localhost:3001';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3002';

async function checkService(url: string) {
  try {
    const { data } = await axios.get(url, { timeout: 3000 });
    return data;
  } catch {
    return { status: 'error', url };
  }
}

app.get('/api/v1/health', async (_req, res) => {
  const [payment, notification] = await Promise.all([
    checkService(`${PAYMENT_SERVICE_URL}/health`),
    checkService(`${NOTIFICATION_SERVICE_URL}/health`),
  ]);

  const allOk = payment.status === 'ok' && notification.status === 'ok';

  res.status(allOk ? 200 : 503).json({
    status:    allOk ? 'ok' : 'degraded',
    service:   'api-gateway',
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    services:  { payment, notification },
  });
});

app.use('/api/v1', rateLimitMiddleware, authMiddleware, proxyMiddleware);

app.use((_req, res) => {
  res.status(404).json({ statusCode: 404, message: 'Ruta no encontrada' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api-gateway] error no manejado:', err.message);
  res.status(500).json({ statusCode: 500, message: 'Error interno del servidor' });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`[api-gateway] corriendo en puerto ${PORT}`);
});