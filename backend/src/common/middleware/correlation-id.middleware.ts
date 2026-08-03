import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const existingId = req.headers['x-correlation-id'] as string;
    const correlationId = existingId || randomUUID();
    (req as any).correlationId = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);
    next();
  }
}
