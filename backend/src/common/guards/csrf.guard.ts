import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionService } from '../../modules/auth/session.service';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const method = req.method.toUpperCase();

    // CSRF check applies only to state-mutating requests
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    const rawToken = req.rawSessionToken;
    const rawCsrfToken = req.headers['x-csrf-token'] as string;

    if (!rawToken || !rawCsrfToken || !this.sessionService.validateCsrfToken(rawToken, rawCsrfToken)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_CSRF',
        title: 'CSRF Token Verification Failed',
        detail: 'Valid X-CSRF-Token header matching authenticated session is required.',
      });
    }

    return true;
  }
}
