import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import {
  IDEMPOTENCY_KEY_OPTIONAL,
  REQUIRE_IDEMPOTENCY_KEY,
} from '../decorators/idempotency.decorator';
import { IdempotencyService } from '../services/idempotency.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const targets = [context.getHandler(), context.getClass()];
    const scope = this.reflector.getAllAndOverride<string>(REQUIRE_IDEMPOTENCY_KEY, targets);

    if (!scope) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const raw = req.headers['idempotency-key'];
    const idempotencyKey = (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined;

    // A route that other clients use too (the kiosk, Snappfood intake) takes a request with no key
    // as it always did.
    if (!idempotencyKey && this.reflector.getAllAndOverride<boolean>(IDEMPOTENCY_KEY_OPTIONAL, targets)) {
      return next.handle();
    }

    const tenantId = (req as any).tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required for idempotency key scope');
    }
    const requestHash = this.idempotencyService.computeHash(scope, req.url, req.body);

    const reservation = await this.idempotencyService.reserveOrReplay(
      tenantId,
      scope,
      idempotencyKey as string,
      requestHash,
    );

    if (reservation.isReplay) {
      res.setHeader('X-Cache-Replay', 'true');
      res.status(reservation.responseStatus || 200);
      return of(reservation.responseBody);
    }

    const recordId = reservation.recordId;
    return next.handle().pipe(
      // The answer is stored before it is sent: a repeat that arrives the moment the first answer
      // does must find it. A failure to store it leaves the key pending (a repeat is told so,
      // never run twice) rather than free.
      mergeMap(async (body) => {
        if (recordId) {
          try {
            await this.idempotencyService.saveResult(recordId, res.statusCode || 200, body);
          } catch (err) {
            this.logger.warn(`Could not store the answer for idempotency key ${scope}: ${(err as Error)?.message}`);
          }
        }
        return body;
      }),
      // A request that failed did not do its work, so its key is free again: the repeat the agent
      // or the register makes runs, instead of waiting out the day for a request that is gone.
      catchError((err) =>
        from(recordId ? this.idempotencyService.release(recordId).catch(() => undefined) : Promise.resolve()).pipe(
          mergeMap(() => throwError(() => err)),
        ),
      ),
    );
  }
}
