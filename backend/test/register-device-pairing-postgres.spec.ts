import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { RegisterDeviceGuard } from '../src/common/guards/register-device.guard';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// A register answers to one device (2026-10-19): pairing, moving it to another device, unpairing,
// and the guard that turns away a device the register is not paired with.
describe('Register device pairing (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let tenants: TenantService;
  let guard: RegisterDeviceGuard;
  let tenantId: string;
  let pos1: string;
  let pos2: string;

  const FRONT = '11111111-1111-4111-8111-111111111111';
  const BACK = '22222222-2222-4222-8222-222222222222';

  const save = <T>(entity: any, data: Partial<T>) =>
    dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;

  /** What the guard says to a write from `deviceId` that names `terminalId` (a read with `method`). */
  const ask = async (terminalId: string, deviceId?: string, method = 'POST') => {
    const req = { method, tenantId, tillTerminalId: terminalId, headers: deviceId ? { 'x-device-id': deviceId } : {} };
    const context: any = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    };
    try {
      return await guard.canActivate(context);
    } catch (err: any) {
      return err.getResponse?.().code as string;
    }
  };

  const terminal = (id: string) => dataSource.getRepository(Terminal).findOneByOrFail({ id });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    tenants = moduleRef.get(TenantService);
    guard = new RegisterDeviceGuard(moduleRef.get(Reflector), dataSource);

    tenantId = (
      await save(Tenant, { code: `PAIR-${Date.now()}`, name: 'Pairing fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    const branchId = (
      await save(Branch, { tenant_id: tenantId, code: 'PAI', name: 'Pairing branch', is_active: true, time_zone: 'Asia/Tehran', latitude: 35.7, longitude: 51.4 })
    ).id;
    pos1 = (await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'POS-1', name: 'Front till', terminal_type: 'CASHIER', is_active: true })).id;
    pos2 = (await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'POS-2', name: 'Back till', terminal_type: 'CASHIER', is_active: true })).id;
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('turns away writes from every device on a register that is not paired, and lets reads and requests without a device id through', async () => {
    expect(await ask(pos1, FRONT)).toBe('REGISTER_DEVICE_UNPAIRED');
    expect(await ask(pos1, FRONT, 'GET')).toBe(true);
    expect(await ask(pos1)).toBe(true);
  });

  it('answers only to the paired device, and records when it was seen', async () => {
    await tenants.pairTerminalDevice(tenantId, pos1, { device_id: FRONT, device_name: 'FRONT-PC' }, 'test');
    await dataSource.query(`UPDATE terminal SET last_seen_at = now() - interval '1 hour' WHERE id = $1`, [pos1]);

    expect(await ask(pos1, FRONT)).toBe(true);
    expect(await ask(pos1, BACK)).toBe('REGISTER_DEVICE_UNPAIRED');

    // The touch is not awaited by the guard; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const seen = (await terminal(pos1)).last_seen_at;
    expect(Date.now() - new Date(seen).getTime()).toBeLessThan(60_000);
  });

  it('names the device that has the register, and moves it only when asked to', async () => {
    let refusal: any;
    try {
      await tenants.pairTerminalDevice(tenantId, pos1, { device_id: BACK, device_name: 'Chrome on Android' }, 'test');
    } catch (err: any) {
      refusal = err.getResponse();
    }
    expect(refusal.code).toBe('REGISTER_PAIRED_ELSEWHERE');
    expect(refusal.context.deviceName).toBe('FRONT-PC');

    await tenants.pairTerminalDevice(tenantId, pos1, { device_id: BACK, device_name: 'Chrome on Android', replace: true }, 'test');
    expect(await ask(pos1, BACK)).toBe(true);
    expect(await ask(pos1, FRONT)).toBe('REGISTER_DEVICE_UNPAIRED');
  });

  it('leaves the old register unpaired when a device moves to another one', async () => {
    await tenants.pairTerminalDevice(tenantId, pos2, { device_id: BACK, device_name: 'Chrome on Android' }, 'test');
    expect((await terminal(pos1)).device_id).toBeNull();
    expect((await terminal(pos2)).device_id).toBe(BACK);
  });

  it('cuts the device off when a manager unpairs it, and keeps the register', async () => {
    await tenants.unpairTerminalDevice(tenantId, pos2, 'test');
    const after = await terminal(pos2);
    expect(after.device_id).toBeNull();
    expect(after.is_active).toBe(true);
    expect(await ask(pos2, BACK)).toBe('REGISTER_DEVICE_UNPAIRED');
  });
});
