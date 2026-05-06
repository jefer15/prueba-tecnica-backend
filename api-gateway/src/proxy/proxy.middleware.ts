import { Request, Response, NextFunction } from 'express';
import axios, { AxiosError }              from 'axios';
import { CircuitBreaker, CircuitOpenError } from '../circuit-breaker/circuit-breaker';

const PAYMENT_SERVICE_URL      = process.env.PAYMENT_SERVICE_URL      ?? 'http://localhost:3001';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3002';

const paymentCircuit      = new CircuitBreaker({ failureThreshold: 5, timeout: 30_000 });
const notificationCircuit = new CircuitBreaker({ failureThreshold: 5, timeout: 30_000 });

function resolveTarget(originalUrl: string): { url: string; circuit: CircuitBreaker } | null {
  const downstreamPath = originalUrl.replace('/api/v1', '');

  if (
    originalUrl.startsWith('/api/v1/transactions') ||
    originalUrl.startsWith('/api/v1/settlements')
  ) {
    return { url: `${PAYMENT_SERVICE_URL}${downstreamPath}`, circuit: paymentCircuit };
  }

  if (originalUrl.startsWith('/api/v1/notifications')) {
    return { url: `${NOTIFICATION_SERVICE_URL}${downstreamPath}`, circuit: notificationCircuit };
  }

  return null;
}

export async function proxyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const target = resolveTarget(req.originalUrl);
  if (!target) return next();

  try {
    const response = await target.circuit.execute(() =>
      axios({
        method: req.method as 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
        url:    target.url,
        headers: {
          ...(req.headers['x-api-key']     && { 'x-api-key':     req.headers['x-api-key'] }),
          ...(req.headers['authorization'] && { authorization:   req.headers['authorization'] }),
          ...(req.headers['content-type']  && { 'content-type':  req.headers['content-type'] }),
        },
        data:           req.body,
        params:         req.query,
        timeout:        10_000,
        validateStatus: () => true,
      }),
    );

    res.status(response.status).json(response.data);

  } catch (err) {
    if (err instanceof CircuitOpenError) {
      res.status(503).json({ statusCode: 503, message: 'Servicio no disponible temporalmente' });
      return;
    }
    if (err instanceof AxiosError && err.code === 'ECONNABORTED') {
      res.status(504).json({ statusCode: 504, message: 'El servicio downstream no respondio a tiempo' });
      return;
    }
    if (err instanceof AxiosError && err.code === 'ECONNREFUSED') {
      res.status(503).json({ statusCode: 503, message: 'No se pudo conectar con el servicio downstream' });
      return;
    }
    next(err);
  }
}