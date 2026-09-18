import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AgentRelease } from '../src/entities/AgentRelease.entity';
import { AgentEnrolmentService } from '../src/modules/agent-gateway/agent-enrolment.service';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { AgentReleasesService } from '../src/modules/agent-gateway/agent-releases.service';
import { HEAD_OFFICE_ONLY_KEY } from '../src/common/decorators/roles.decorator';
import { AgentReleasesController } from '../src/modules/agent-gateway/agent-releases.controller';
import { deleteTenantData } from './utils/tenant-teardown';
import { TestAgent } from './utils/agent-client';

// Release rows belong to the whole installation, so this suite uses versions no real build
// would have and removes them afterwards.
describe('agent releases (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let releases: AgentReleasesService;
  let base: string;
  let dataDir: string;
  let tenantId: string;
  let deviceKey: string;
  const versions: string[] = [];
  let publishedId: string;
  let publishedVersion: string;
  const open: TestAgent[] = [];
  const actor = () => ({ tenantId });

  const stamp = Date.now() % 10000;
  const version = (patch: number) => {
    const v = `0.${stamp}.${patch}`;
    versions.push(v);
    return v;
  };
  const exe = (text: string) => Buffer.concat([Buffer.from('MZ'), Buffer.from(text)]);
  const upload = (v: string, buffer: Buffer, extra: Record<string, string> = {}) =>
    releases.upload({ version: v, file: { buffer, size: buffer.length }, ...extra }, actor());
  const agentGet = (url: string, key = deviceKey) =>
    request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${key}`);

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gnext-agent-releases-'));
    process.env.DATA_DIR = dataDir;
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.listen(0, '127.0.0.1');
    base = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    dataSource = moduleRef.get(DataSource);
    releases = moduleRef.get(AgentReleasesService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (
      await save(Tenant, { code: `AGENTREL-${Date.now()}`, name: 'Agent release fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    const branchId = (await save(Branch, { tenant_id: tenantId, code: 'ARL', name: 'Release branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const { code } = await moduleRef.get(AgentRegistryService).createEnrolmentCode(tenantId, branchId, {});
    deviceKey = (await moduleRef.get(AgentEnrolmentService).enrol({ code }, { clientKey: 'test', wsUrl: '' })).device_key;
  }, 60000);

  afterEach(async () => {
    for (const a of open.splice(0)) {
      a.ws.terminate();
      await a.closed;
    }
  });

  afterAll(async () => {
    await dataSource.getRepository(AgentRelease).delete({ version: In(versions) });
    await deleteTenantData(dataSource, tenantId);
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('is head office only', () => {
    expect(Reflect.getMetadata(HEAD_OFFICE_ONLY_KEY, AgentReleasesController)).toBe(true);
  });

  it('accepts only a versioned Windows executable', async () => {
    await expect(upload('1.0', exe('x'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(upload(version(90), Buffer.from('#!/bin/sh'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(upload(version(91), Buffer.alloc(0))).rejects.toBeInstanceOf(BadRequestException);
    await expect(upload(version(92), exe('x'), { minAgentVersion: '9.9.9' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores the build with its hash, and keeps it from agents until published', async () => {
    const v = version(1);
    const bytes = exe('agent build one');
    const uploaded = await upload(v, bytes, { notes: 'first' });

    expect(uploaded).toMatchObject({ version: v, size_bytes: bytes.length, published: false, notes: 'first' });
    expect(uploaded.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(uploaded).not.toHaveProperty('file_path');
    expect(await fs.readFile(path.join(dataDir, 'agent-releases', v, 'gnext-agent.exe'))).toEqual(bytes);
    await expect(upload(v, bytes)).rejects.toMatchObject({ status: 409 });

    const latest = await agentGet('/api/v1/agent/releases/latest');
    expect(latest.status === 204 || latest.body.version !== v).toBe(true);
    await agentGet(`/api/v1/agent/releases/${v}/gnext-agent.exe`).expect(404);
  });

  it('publishes a build, tells older agents online, and serves the exact bytes', async () => {
    const v = version(2);
    const bytes = exe('agent build two '.repeat(1000));
    const uploaded = await upload(v, bytes);

    const older = new TestAgent(`${base}/api/v1/agent/ws`, deviceKey);
    open.push(older);
    await older.opened;
    const hello = older.send('hello', { agent_version: '0.0.1', protocol_versions: [1], capabilities: [] });
    await older.next((m) => m.ref === hello);

    await releases.publish(uploaded.id, actor());
    publishedId = uploaded.id;
    publishedVersion = v;

    await older.next((m) => m.type === 'agent.check_update');
    const latest = await agentGet('/api/v1/agent/releases/latest').expect(200);
    expect(latest.body).toEqual({
      version: v,
      url: `/api/v1/agent/releases/${v}/gnext-agent.exe`,
      sha256: uploaded.sha256,
      size: bytes.length,
      released_at: expect.any(String),
      min_agent_version: null,
    });

    const download = await agentGet(latest.body.url).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('application/octet-stream');
    expect(Number(download.headers['content-length'])).toBe(bytes.length);
    expect(createHash('sha256').update(download.body).digest('hex')).toBe(uploaded.sha256);

    // A welcome tells an older agent there is something newer.
    const next = new TestAgent(`${base}/api/v1/agent/ws`, deviceKey);
    open.push(next);
    await next.opened;
    const id = next.send('hello', { agent_version: '0.0.1', protocol_versions: [1], capabilities: [] });
    const welcome = await next.next((m) => m.type === 'welcome' && m.ref === id);
    expect(welcome.payload.update).toEqual({ available: true, version: v });
  });

  it('serves nothing to a caller without a valid key', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agent/releases/latest');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AGENT_KEY_INVALID');
    await agentGet('/api/v1/agent/releases/latest', 'gak_' + 'y'.repeat(43)).expect(401);
    await agentGet('/api/v1/agent/releases/..%2F..%2Fetc/gnext-agent.exe').expect(404);
  });

  describe('uploads from CI', () => {
    const token = 'ci-token-for-tests-' + 'k'.repeat(40);
    const ciPost = (v: string, bytes: Buffer, bearer: string | null = token, commit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678') => {
      const req = request(app.getHttpServer()).post('/api/v1/agent-releases/ci');
      if (bearer) req.set('Authorization', `Bearer ${bearer}`);
      return req.field('version', v).field('commit', commit).attach('file', bytes, 'gnext-agent.exe');
    };
    const stored = (v: string) => fs.readFile(path.join(dataDir, 'agent-releases', v, 'gnext-agent.exe'));

    beforeEach(() => {
      process.env.AGENT_RELEASE_CI_TOKEN = token;
    });
    afterAll(() => {
      delete process.env.AGENT_RELEASE_CI_TOKEN;
    });

    it('is off until the server has a token', async () => {
      delete process.env.AGENT_RELEASE_CI_TOKEN;
      await ciPost(version(10), exe('x')).expect(503);
      process.env.AGENT_RELEASE_CI_TOKEN = 'short';
      await ciPost(version(11), exe('x'), 'short').expect(503);
    });

    it('refuses a missing or wrong token, and stores nothing', async () => {
      const v = version(12);
      await ciPost(v, exe('x'), null).expect(401);
      await ciPost(v, exe('x'), token + 'x').expect(401);
      await ciPost(v, exe('x'), 'k'.repeat(64)).expect(401);
      expect(await dataSource.getRepository(AgentRelease).findOne({ where: { version: v } })).toBeNull();
    });

    it('stores a new version unpublished, with the commit in its notes', async () => {
      const v = version(13);
      const bytes = exe('ci build');
      const res = await ciPost(v, bytes).expect(200);

      expect(res.body).toMatchObject({ created: true, sha256_matches: true });
      expect(res.body.release).toMatchObject({ version: v, published: false, uploaded_by: null, notes: 'Built by CI from commit a1b2c3d4e5f6.' });
      expect(res.body.release.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(await stored(v)).toEqual(bytes);
      await agentGet(`/api/v1/agent/releases/${v}/gnext-agent.exe`).expect(404);
    });

    it('treats the same version again as done, and says when the build behind it changed', async () => {
      const v = version(14);
      const first = exe('build of 14');
      await ciPost(v, first).expect(200);

      const again = await ciPost(v, first).expect(200);
      expect(again.body).toMatchObject({ created: false, sha256_matches: true });

      const changed = await ciPost(v, exe('build of 14, changed without a bump')).expect(200);
      expect(changed.body).toMatchObject({ created: false, sha256_matches: false });
      expect(changed.body.release.sha256).toBe(createHash('sha256').update(first).digest('hex'));
      expect(await stored(v)).toEqual(first);
    });

    it('checks the build like a manual upload', async () => {
      await ciPost(version(15), Buffer.from('#!/bin/sh')).expect(400);
      await ciPost('latest', exe('x')).expect(400);
    });

    it('keeps the file of the upload that won when two race', async () => {
      const v = version(16);
      const results = await Promise.all([ciPost(v, exe('racer one')), ciPost(v, exe('racer two')), ciPost(v, exe('racer three'))]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(results.filter((r) => r.body.created)).toHaveLength(1);

      const row = await dataSource.getRepository(AgentRelease).findOneOrFail({ where: { version: v } });
      expect(createHash('sha256').update(await stored(v)).digest('hex')).toBe(row.sha256);
      const leftovers = (await fs.readdir(path.join(dataDir, 'agent-releases', v))).filter((f) => f.endsWith('.part'));
      expect(leftovers).toEqual([]);
    });
  });

  it('withdraws a build on unpublish', async () => {
    const withdrawn = await releases.unpublish(publishedId, actor());
    expect(withdrawn.published).toBe(false);
    await agentGet(`/api/v1/agent/releases/${publishedVersion}/gnext-agent.exe`).expect(404);
    const latest = await agentGet('/api/v1/agent/releases/latest');
    expect(latest.status === 204 || latest.body.version !== publishedVersion).toBe(true);
  });
});
