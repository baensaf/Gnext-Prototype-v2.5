import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionService } from '../../modules/auth/session.service';
import { AdminUser } from '../../entities/AdminUser.entity';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
    @InjectRepository(AdminUser)
    private readonly userRepo: Repository<AdminUser>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    let rawToken = req.cookies?.gnext_session;

    if (!rawToken && req.headers.authorization) {
      const authHeader = req.headers.authorization as string;
      if (authHeader.startsWith('Bearer ')) {
        rawToken = authHeader.substring(7).trim();
      }
    }

    if (!rawToken) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        title: 'Not Authenticated',
        detail: 'Authentication session token required.',
      });
    }

    const session = await this.sessionService.findValidSession(rawToken);
    if (!session) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        title: 'Not Authenticated',
        detail: 'Session token is invalid, expired, or revoked.',
      });
    }

    const user = await this.userRepo.findOne({ where: { id: session.user_id } });
    if (!user || !user.is_active) {
      throw new UnauthorizedException({
        code: 'USER_INACTIVE',
        title: 'User Disabled',
        detail: 'User account is inactive or disabled.',
      });
    }

    req.session = session;
    req.rawSessionToken = rawToken;
    req.user = user;
    req.userId = user.id;
    req.tenantId = user.tenant_id;
    req.userRole = user.role;
    // NULL here means head office. Handlers use it to decide what a request may reach,
    // so it has to come from the stored account rather than anything the client sends.
    req.userBranchId = user.branch_id ?? null;

    return true;
  }
}
