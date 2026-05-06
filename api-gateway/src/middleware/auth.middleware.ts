import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'PRUEBA_TECNICA_SECRET_KEY';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      (req as Request & { jwtPayload: unknown }).jwtPayload = payload;
      return next();
    } catch {
      res.status(401).json({ statusCode: 401, message: 'Token JWT invalido o expirado' });
      return;
    }
  }

  const apiKey = req.headers['x-api-key'];

  if (apiKey) {
    return next();
  }

  res.status(401).json({ statusCode: 401, message: 'Autenticacion requerida: JWT o API key' });
}
