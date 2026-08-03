import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../src/modules/auth/auth.service';
import { SessionService } from '../src/modules/auth/session.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { Tenant } from '../src/entities/Tenant.entity';
import { Session } from '../src/entities/Session.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import * as argon2 from 'argon2';
import { UnauthorizedException } from '@nestjs/common';

describe('AuthService (Unit)', () => {
  let authService: AuthService;
  let userRepo: any;
  let tenantRepo: any;
  let sessionService: any;
  let auditWriter: any;

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    tenantRepo = {
      findOne: jest.fn(),
    };
    sessionService = {
      createSession: jest.fn(),
      findValidSession: jest.fn(),
      revokeSession: jest.fn(),
      generateCsrfToken: jest.fn().mockReturnValue('mock-csrf-token'),
    };
    auditWriter = {
      write: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(AdminUser), useValue: userRepo },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: SessionService, useValue: sessionService },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  it('should throw UnauthorizedException when user not found', async () => {
    userRepo.findOne.mockResolvedValue(null);
    await expect(authService.login('unknown@gnext.local', 'password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when password does not match', async () => {
    const hash = await argon2.hash('correct-password');
    userRepo.findOne.mockResolvedValue({
      id: 'user-id',
      tenant_id: 'tenant-id',
      username: 'admin@gnext.local',
      password_hash: hash,
      is_active: true,
    });

    await expect(authService.login('admin@gnext.local', 'wrong-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should return tokens and user details on valid password', async () => {
    const password = 'GnextDemo!2026';
    const hash = await argon2.hash(password);
    const mockUser = {
      id: 'user-uuid',
      tenant_id: 'tenant-uuid',
      username: 'admin@gnext.local',
      display_name: 'Admin',
      password_hash: hash,
      is_active: true,
      preferred_locale: 'fa',
    };
    const mockTenant = {
      id: 'tenant-uuid',
      code: 'GNEXT',
      name: 'Gnext Prototype',
      base_currency: 'IRR',
      default_locale: 'fa',
      time_zone: 'Asia/Tehran',
    };

    userRepo.findOne.mockResolvedValue(mockUser);
    userRepo.save.mockResolvedValue(mockUser);
    tenantRepo.findOne.mockResolvedValue(mockTenant);
    sessionService.createSession.mockResolvedValue({
      rawToken: 'token-123',
      rawCsrfToken: 'csrf-123',
    });

    const result = await authService.login('admin@gnext.local', password);

    expect(result.sessionToken).toBe('token-123');
    expect(result.csrfToken).toBe('csrf-123');
    expect(result.user.username).toBe('admin@gnext.local');
    expect(result.tenant.code).toBe('GNEXT');
    expect(auditWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_LOGIN_SUCCESS' }),
    );
  });
});
