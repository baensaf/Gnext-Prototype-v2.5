import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { AdminUser } from '../../entities/AdminUser.entity';
import { Tenant } from '../../entities/Tenant.entity';
import { SessionService } from './session.service';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly userRepo: Repository<AdminUser>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly sessionService: SessionService,
    private readonly auditWriter: AuditWriter,
  ) {}

  async login(username: string, password: string, ip?: string, userAgent?: string, correlationId?: string) {
    const user = await this.userRepo.findOne({
      where: { username: username.toLowerCase().trim() },
    });

    if (!user || !user.is_active) {
      const defaultTenant = !user ? await this.tenantRepo.findOne({}) : null;
      await this.auditWriter.write({
        tenantId: user ? user.tenant_id : (defaultTenant?.id || ''),
        actorType: 'ADMIN',
        action: 'AUTH_LOGIN_FAILED',
        correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
        ip,
        details: { username, reason: 'INVALID_CREDENTIALS' },
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        title: 'Authentication Failed',
        detail: 'Invalid username or password.',
      });
    }

    const isValidPassword = await argon2.verify(user.password_hash, password);
    if (!isValidPassword) {
      await this.auditWriter.write({
        tenantId: user.tenant_id,
        actorType: 'ADMIN',
        actorId: user.id,
        action: 'AUTH_LOGIN_FAILED',
        correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
        ip,
        details: { username, reason: 'INVALID_PASSWORD' },
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        title: 'Authentication Failed',
        detail: 'Invalid username or password.',
      });
    }

    // Update last_login_at
    user.last_login_at = new Date();
    await this.userRepo.save(user);

    const { rawToken, rawCsrfToken } = await this.sessionService.createSession(user.id, ip, userAgent);

    const tenant = await this.tenantRepo.findOne({ where: { id: user.tenant_id } });

    await this.auditWriter.write({
      tenantId: user.tenant_id,
      actorType: 'ADMIN',
      actorId: user.id,
      action: 'AUTH_LOGIN_SUCCESS',
      correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
      ip,
      details: { username },
    });

    return {
      sessionToken: rawToken,
      csrfToken: rawCsrfToken,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        preferredLocale: user.preferred_locale,
        tenantId: user.tenant_id,
        role: user.role,
      },
      tenant: tenant
        ? {
            id: tenant.id,
            code: tenant.code,
            name: tenant.name,
            baseCurrency: tenant.base_currency,
            defaultLocale: tenant.default_locale,
            timeZone: tenant.time_zone,
          }
        : null,
    };
  }

  async getMe(rawToken: string) {
    const session = await this.sessionService.findValidSession(rawToken);
    if (!session) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        title: 'Not Authenticated',
        detail: 'Active session not found or expired.',
      });
    }

    const user = await this.userRepo.findOne({ where: { id: session.user_id } });
    if (!user || !user.is_active) {
      throw new UnauthorizedException({
        code: 'USER_INACTIVE',
        title: 'User Account Inactive',
        detail: 'User account is disabled or missing.',
      });
    }

    const tenant = await this.tenantRepo.findOne({ where: { id: user.tenant_id } });

    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        preferredLocale: user.preferred_locale,
        tenantId: user.tenant_id,
        role: user.role,
      },
      tenant: tenant
        ? {
            id: tenant.id,
            code: tenant.code,
            name: tenant.name,
            baseCurrency: tenant.base_currency,
            defaultLocale: tenant.default_locale,
            timeZone: tenant.time_zone,
          }
        : null,
      csrfToken: rawToken ? this.sessionService.deriveCsrfToken(rawToken) : null,
    };
  }

  async logout(rawToken: string, correlationId?: string, ip?: string) {
    const session = await this.sessionService.findValidSession(rawToken);
    if (session) {
      const user = await this.userRepo.findOne({ where: { id: session.user_id } });
      await this.sessionService.revokeSession(rawToken);
      if (user) {
        await this.auditWriter.write({
          tenantId: user.tenant_id,
          actorType: 'ADMIN',
          actorId: user.id,
          action: 'AUTH_LOGOUT',
          correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
          ip,
          details: { username: user.username },
        });
      }
    }
    return { success: true };
  }

  async changeLanguage(rawToken: string, locale: string, correlationId?: string) {
    if (!['en', 'fa'].includes(locale)) {
      throw new BadRequestException({
        code: 'INVALID_LOCALE',
        title: 'Invalid Locale',
        detail: 'Locale must be en or fa.',
      });
    }

    const session = await this.sessionService.findValidSession(rawToken);
    if (!session) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        title: 'Not Authenticated',
        detail: 'Active session not found.',
      });
    }

    const user = await this.userRepo.findOne({ where: { id: session.user_id } });
    if (user) {
      user.preferred_locale = locale;
      await this.userRepo.save(user);

      await this.auditWriter.write({
        tenantId: user.tenant_id,
        actorType: 'ADMIN',
        actorId: user.id,
        action: 'USER_CHANGE_LANGUAGE',
        correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
        details: { preferredLocale: locale },
      });
    }

    return { success: true, locale };
  }
}
