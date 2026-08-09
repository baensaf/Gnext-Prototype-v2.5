import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
    (req as any).correlationId = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);

    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    (req as any).clientIp = clientIp;

    const acceptLang = req.headers['accept-language'] as string;
    const preferredLocale = acceptLang && acceptLang.startsWith('en') ? 'en' : 'fa';
    (req as any).locale = preferredLocale;

    next();
  }
}
