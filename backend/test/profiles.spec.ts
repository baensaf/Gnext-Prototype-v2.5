import { NotFoundException } from '@nestjs/common';
import { HEAD_OFFICE_ONLY_KEY } from '../src/common/decorators/roles.decorator';
import { BRANCH_OWNED_KEY } from '../src/common/decorators/branch-owned.decorator';
import { Courier } from '../src/entities/Courier.entity';
import { ProfilesController } from '../src/modules/profiles/profiles.controller';
import { ProfilesService, maskAuditPayload } from '../src/modules/profiles/profiles.service';

describe('Entity 360 profiles', () => {
  describe('who may open them', () => {
    const handler = (name: keyof ProfilesController) => ProfilesController.prototype[name];

    it('keeps customer and account profiles with head office, where their lists live', () => {
      expect(Reflect.getMetadata(HEAD_OFFICE_ONLY_KEY, handler('customerProfile'))).toBe(true);
      expect(Reflect.getMetadata(HEAD_OFFICE_ONLY_KEY, handler('userProfile'))).toBe(true);
    });

    it('lets a branch open only its own couriers', () => {
      expect(Reflect.getMetadata(HEAD_OFFICE_ONLY_KEY, handler('courierProfile'))).toBeUndefined();
      expect(Reflect.getMetadata(BRANCH_OWNED_KEY, handler('courierProfile'))).toEqual({ entity: Courier });
    });
  });

  describe('audit payloads', () => {
    it('masks credentials at any depth and leaves the rest alone', () => {
      expect(
        maskAuditPayload({
          role: 'CASHIER',
          pin: '2468',
          nested: { password_hash: 'x', card_number: '6037', amount: '10.0000' },
          list: [{ token: 'abc', name: 'kept' }],
        }),
      ).toEqual({
        role: 'CASHIER',
        pin: '***MASKED***',
        nested: { password_hash: '***MASKED***', card_number: '***MASKED***', amount: '10.0000' },
        list: [{ token: '***MASKED***', name: 'kept' }],
      });
      expect(maskAuditPayload(null)).toBeNull();
    });
  });

  describe('ProfilesService', () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const userId = '22222222-2222-2222-2222-222222222222';
    let query: jest.Mock;
    let service: ProfilesService;

    beforeEach(() => {
      query = jest.fn().mockResolvedValue([]);
      service = new ProfilesService({ query } as any, {} as any, {} as any);
    });

    it('refuses an account that does not exist in the tenant', async () => {
      await expect(service.userProfile(tenantId, userId)).rejects.toBeInstanceOf(NotFoundException);
      expect(query.mock.calls[0][1]).toEqual([tenantId, userId]);
    });

    it("reads an account's orders, shifts and audit trail by that account", async () => {
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM admin_user u')) return [{ id: userId, username: 'cashier' }];
        if (sql.includes('FROM audit_event')) {
          return [{ id: 'e1', action: 'USER_UPDATED', after_data: { role: 'MANAGER', pin: '1' }, before_data: null, details: null }];
        }
        if (sql.includes('COUNT(*)')) return [{ order_count: 3 }];
        return [];
      });

      const profile = await service.userProfile(tenantId, userId);

      expect(profile.user.username).toBe('cashier');
      expect(profile.audit[0].after_data).toEqual({ role: 'MANAGER', pin: '***MASKED***' });

      const sqls = query.mock.calls.map(([sql]) => sql as string);
      expect(sqls.some((sql) => sql.includes('FROM order_header o') && sql.includes('o.created_by = $2'))).toBe(true);
      expect(sqls.some((sql) => sql.includes('FROM cashier_shift s') && sql.includes('s.opened_by = $2'))).toBe(true);
      const audit = sqls.find((sql) => sql.includes('FROM audit_event'))!;
      expect(audit).toContain('a.actor_id::text = $2');
      expect(audit).toContain("a.action <> 'USER_CHANGE_LANGUAGE'");
      // Every query is scoped to the tenant and handed the id as a parameter, never spliced in.
      for (const [sql, params] of query.mock.calls) {
        expect(sql).not.toContain(userId);
        expect(params[0]).toBe(tenantId);
      }
    });
  });
});
