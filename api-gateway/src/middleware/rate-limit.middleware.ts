import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart >= WINDOW_MS) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = (req.headers['x-api-key'] as string) ?? req.ip ?? 'anonymous';
  const now = Date.now();

  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
    return next();
  }

  entry.count++;

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - entry.windowStart)) / 1000);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      statusCode: 429,
      message: 'Too Many Requests',
      retry_after_seconds: retryAfter,
    });
    return;
  }

  next();
}
