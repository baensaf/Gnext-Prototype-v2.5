import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { REQUIRE_IDEMPOTENCY_KEY } from '../decorators/idempotency.decorator';
import { IdempotencyService } from '../services/idempotency.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const scope = this.reflector.getAllAndOverride<string>(REQUIRE_IDEMPOTENCY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!scope) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const idempotencyKey = req.headers['idempotency-key'] as string;
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000000';
    const requestHash = this.idempotencyService.computeHash(scope, req.url, req.body);

    const reservation = await this.idempotencyService.reserveOrReplay(
      tenantId,
      scope,
      idempotencyKey,
      requestHash,
    );

    if (reservation.isReplay) {
      res.setHeader('X-Cache-Replay', 'true');
      res.status(reservation.responseStatus || 200);
      return of(reservation.responseBody);
    }

    const recordId = reservation.recordId;
    return next.handle().pipe(
      tap((body) => {
        const status = res.statusCode || 200;
        if (recordId) {
          this.idempotencyService.saveResult(recordId, status, body).catch(() => {});
        }
      }),
    );
  }
}
