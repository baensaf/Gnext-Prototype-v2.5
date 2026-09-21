import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import * as http from 'http';
import { DataSource } from 'typeorm';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { Courier } from '../src/entities/Courier.entity';
import { SessionService } from '../src/modules/auth/session.service';
import { LiveChangesService } from '../src/modules/live/live-changes.service';
import { deleteTenantData } from './utils/tenant-teardown';

/** An open SSE stream and the `change` events it has received. */
interface Stream {
  status: number;
  changes: string[];
  ready: Promise<void>;
  close: () => void;
}

// The trigger, the listener and the stream together: a row written through the database
// reaches exactly the pages that should hear about it.
describe('live change stream (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let port: number;
  const tenants: string[] = [];
  const streams: Stream[] = [];

  const save = <T>(entity: any, data: Partial<T>) =>
    dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;

  const fixture = async (label: string) => {
    const tenant = await save(Tenant, {
      code: `LIVE-${label}-${Date.now()}`,
      name: 'Live fixture',
      base_currency: 'IRR',
      default_locale: 'fa',
      time_zone: 'Asia/Tehran',
    });
    tenants.push(tenant.id);
    const branch = (code: string) =>
      save(Branch, { tenant_id: tenant.id, code, name: code, is_active: true, time_zone: 'Asia/Tehran' });
    const [a, b] = [await branch('LA'), await branch('LB')];
    const login = async (branchId: string | null) => {
      const user = await save(AdminUser, {
        tenant_id: tenant.id,
        username: `live-${label}-${branchId ?? 'hq'}-${Date.now()}`,
        display_name: 'Live',
        password_hash: 'x',
        role: branchId ? 'MANAGER' : 'SUPER_ADMIN',
        branch_id: branchId,
      });
      return (await moduleRef.get(SessionService).createSession(user.id)).rawToken;
    };
    return { tenantId: tenant.id, branchA: a.id, branchB: b.id, login };
  };

  const open = (query: string, token?: string): Stream => {
    const stream: Stream = { status: 0, changes: [], ready: null as any, close: () => undefined };
    stream.ready = new Promise((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: `/api/v1/live/stream?${query}`, headers: token ? { Cookie: `gnext_session=${token}` } : {} },
        (res) => {
          stream.status = res.statusCode!;
          if (res.statusCode !== 200) return resolve();
          let buffer = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buffer += chunk;
            let end: number;
            while ((end = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              if (block.includes('event: ready')) resolve();
              const data = block.match(/^event: change\ndata: (.*)$/m);
              if (data) stream.changes.push(JSON.parse(data[1]).topic);
            }
          });
        },
      );
      req.on('error', reject);
      stream.close = () => req.destroy();
    });
    streams.push(stream);
    return stream;
  };

  /** Notices are asynchronous; give them a moment to arrive, or to not arrive. */
  const settle = () => new Promise((r) => setTimeout(r, 400));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
    dataSource = moduleRef.get(DataSource);
    // The listener connects on its own; rows written before it listens go unheard.
    await moduleRef.get(LiveChangesService).listening;
  }, 60000);

  afterEach(() => {
    for (const s of streams.splice(0)) s.close();
  });

  afterAll(async () => {
    for (const id of tenants) await deleteTenantData(dataSource, id);
    await app.close();
  });

  it('refuses a stream without a session', async () => {
    const stream = open('topics=delivery');
    await stream.ready;
    expect(stream.status).toBe(401);
  });

  it('tells head office about its own tenant only', async () => {
    const mine = await fixture('HQ');
    const other = await fixture('OTHER');
    const stream = open('topics=delivery', await mine.login(null));
    await stream.ready;

    await save(Courier, { tenant_id: other.tenantId, branch_id: other.branchA, code: 'C1', name: 'Not mine', phone: '09120000001' });
    await dataSource.query(`UPDATE courier SET name = 'Still not mine' WHERE tenant_id = $1`, [other.tenantId]);
    await settle();
    expect(stream.changes).toEqual([]);

    await save(Courier, { tenant_id: mine.tenantId, branch_id: mine.branchB, code: 'C1', name: 'Mine', phone: '09120000002' });
    await settle();
    expect(stream.changes).toEqual(['delivery']);
  });

  it('keeps a branch account to its own branch, whatever branch it names', async () => {
    const f = await fixture('BR');
    const stream = open(`topics=delivery,kds&branchId=${f.branchB}`, await f.login(f.branchA));
    await stream.ready;

    await save(Courier, { tenant_id: f.tenantId, branch_id: f.branchB, code: 'CB', name: 'Other shop', phone: '09120000003' });
    await settle();
    expect(stream.changes).toEqual([]);

    await save(Courier, { tenant_id: f.tenantId, branch_id: f.branchA, code: 'CA', name: 'This shop', phone: '09120000004' });
    await settle();
    expect(stream.changes).toEqual(['delivery']);
  });
});
