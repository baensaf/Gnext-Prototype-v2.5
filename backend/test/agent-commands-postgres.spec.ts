import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AgentCommand } from '../src/entities/AgentCommand.entity';
import { AuditEvent } from '../src/entities/AuditEvent.entity';
import { AgentEnrolmentService } from '../src/modules/agent-gateway/agent-enrolment.service';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { AgentCommandsService, RESEND_AFTER_MS } from '../src/modules/agent-gateway/agent-commands.service';
import { deleteTenantData } from './utils/tenant-teardown';
import { TestAgent } from './utils/agent-client';

const until = async (check: () => Promise<boolean> | boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
};

// Command delivery end to end: stored first, sent when the agent is there, resent until acked,
// replayed on reconnect, settled by the ack or the result — exactly once.
describe('agent command delivery (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let commands: AgentCommandsService;
  let registry: AgentRegistryService;
  let enrolment: AgentEnrolmentService;
  let wsUrl: string;
  let tenantId: string;
  let branchId: string;
  let otherBranchId: string;
  let deviceKey: string;
  let agentId: string;
  const open: TestAgent[] = [];
  const settled: AgentCommand[] = [];
  let applier: jest.Mock;

  const row = (id: string) => dataSource.getRepository(AgentCommand).findOneByOrFail({ id });
  const connect = async () => {
    const agent = new TestAgent(wsUrl, deviceKey);
    open.push(agent);
    await agent.handshake();
    return agent;
  };
  const enqueue = (type = 'test.job', payload: Record<string, any> = { n: 1 }, options = {}) =>
    commands.enqueue(tenantId, branchId, type, payload, options);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    commands = moduleRef.get(AgentCommandsService);
    applier = jest.fn();
    // A stand-in for printing and payments: the applier writes a row in the same transaction.
    commands.registerResult('test.result', ['test.job'], async (ctx) => {
      const outcome = await applier(ctx);
      await ctx.em.save(
        AuditEvent,
        ctx.em.create(AuditEvent, {
          tenant_id: ctx.command.tenant_id,
          event_type: 'TEST_RESULT_APPLIED',
          actor_type: 'SYSTEM',
          action: 'TEST_RESULT_APPLIED',
          correlation_id: ctx.command.id,
        }),
      );
      return outcome;
    });
    commands.onSettled((c) => {
      settled.push(c);
    });
    await app.listen(0, '127.0.0.1');
    wsUrl = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/agent/ws`;
    dataSource = moduleRef.get(DataSource);
    registry = moduleRef.get(AgentRegistryService);
    enrolment = moduleRef.get(AgentEnrolmentService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (
      await save(Tenant, { code: `AGENTCMD-${Date.now()}`, name: 'Agent command fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'ACM', name: 'Command branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    otherBranchId = (await save(Branch, { tenant_id: tenantId, code: 'ACO', name: 'Other branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const { code } = await registry.createEnrolmentCode(tenantId, branchId, {});
    const enrolled = await enrolment.enrol({ code }, { clientKey: 'test', wsUrl: '' });
    deviceKey = enrolled.device_key;
    agentId = enrolled.agent_id;
  }, 60000);

  beforeEach(() => {
    applier.mockReset();
    settled.length = 0;
  });

  afterEach(async () => {
    for (const a of open.splice(0)) {
      a.ws.terminate();
      await a.closed;
    }
    // Leave no pending command behind to be replayed into the next test.
    await dataSource
      .getRepository(AgentCommand)
      .update({ tenant_id: tenantId, status: 'QUEUED' }, { status: 'DONE' });
    await dataSource.getRepository(AgentCommand).update({ tenant_id: tenantId, status: 'SENT' }, { status: 'DONE' });
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('keeps a command while the branch is offline and delivers it after welcome', async () => {
    const command = await enqueue('test.job', { job: 'a' });
    expect((await row(command.id)).status).toBe('QUEUED');

    const agent = await connect();
    const delivered = await agent.next((m) => m.id === command.id);

    expect(delivered).toMatchObject({ v: 1, type: 'test.job', payload: { job: 'a' } });
    expect(new Date(delivered.payload.expires_at).getTime()).toBe(new Date(command.expires_at).getTime());
    expect(agent.frames.findIndex((m) => m.type === 'welcome')).toBeLessThan(agent.frames.indexOf(delivered));
    await until(async () => (await row(command.id)).status === 'SENT');
    expect((await row(command.id)).send_count).toBe(1);
  });

  it('sends at once when the agent is online, and settles on ack then result, once', async () => {
    const agent = await connect();
    applier.mockResolvedValue(undefined);
    const command = await enqueue();
    await agent.next((m) => m.id === command.id);

    agent.send('ack', { ok: true }, undefined, command.id);
    await until(async () => (await row(command.id)).status === 'ACKED');
    expect(await row(command.id)).toMatchObject({ agent_id: agentId });

    const resultId = agent.send('test.result', { outcome: 'fine' }, undefined, command.id);
    const ack = await agent.next((m) => m.type === 'ack' && m.ref === resultId);
    expect(ack.payload).toEqual({ ok: true });

    const done = await row(command.id);
    expect(done).toMatchObject({ status: 'DONE', result: { outcome: 'fine' }, result_message_id: resultId });
    expect(applier).toHaveBeenCalledTimes(1);
    expect(settled.map((c) => c.id)).toEqual([command.id]);

    // The agent resends the same result: acked again, applied never again.
    agent.frames.length = 0;
    agent.send('test.result', { outcome: 'fine' }, resultId, command.id);
    await agent.next((m) => m.type === 'ack' && m.ref === resultId);
    expect(applier).toHaveBeenCalledTimes(1);
    const applied = await dataSource.getRepository(AuditEvent).count({ where: { tenant_id: tenantId, correlation_id: command.id } });
    expect(applied).toBe(1);
  });

  it('resends an unacked command with the same id, and replays it after a reconnect', async () => {
    const first = await connect();
    const command = await enqueue();
    await first.next((m) => m.id === command.id);
    await until(async () => (await row(command.id)).status === 'SENT');

    first.frames.length = 0;
    await commands.tick(new Date(Date.now() + RESEND_AFTER_MS + 1000), tenantId);
    await first.next((m) => m.id === command.id);
    expect((await row(command.id)).send_count).toBe(2);

    first.ws.terminate();
    await first.closed;
    const second = await connect();
    await second.next((m) => m.id === command.id);
    await until(async () => (await row(command.id)).send_count === 3);
  });

  it('fails a command the agent refuses, and expects no result', async () => {
    const agent = await connect();
    const command = await enqueue();
    await agent.next((m) => m.id === command.id);

    agent.send('ack', { ok: false, error: { code: 'DEVICE_NOT_CONFIGURED', message: 'no printer' } }, undefined, command.id);

    await until(async () => (await row(command.id)).status === 'FAILED');
    expect(await row(command.id)).toMatchObject({ error_code: 'DEVICE_NOT_CONFIGURED', error_message: 'no printer' });
    await until(() => settled.some((c) => c.id === command.id && c.status === 'FAILED'));

    // A result for a refused command changes nothing.
    const resultId = agent.send('test.result', {}, undefined, command.id);
    await agent.next((m) => m.ref === resultId);
    expect(applier).not.toHaveBeenCalled();
    expect((await row(command.id)).status).toBe('FAILED');
  });

  it('finishes an ack-only command on its ack', async () => {
    const agent = await connect();
    const command = await enqueue('agent.check_update', {});
    expect(command.expects_result).toBe(false);
    await agent.next((m) => m.id === command.id);
    agent.send('ack', { ok: true }, undefined, command.id);
    await until(async () => (await row(command.id)).status === 'DONE');
  });

  it('expires what nobody acked, but still applies a late result: the work may have happened', async () => {
    const command = await enqueue('test.job', {}, { ttlMs: 60_000 });
    await commands.tick(new Date(Date.now() + 61_000), tenantId);
    expect(await row(command.id)).toMatchObject({ status: 'EXPIRED', error_code: 'EXPIRED' });
    expect(settled.map((c) => [c.id, c.status])).toEqual([[command.id, 'EXPIRED']]);

    // An expired command is never delivered.
    const agent = await connect();
    await new Promise((r) => setTimeout(r, 200));
    expect(agent.frames.some((m) => m.id === command.id)).toBe(false);

    applier.mockResolvedValue({ status: 'DONE' });
    const resultId = agent.send('test.result', { late: true }, undefined, command.id);
    await agent.next((m) => m.ref === resultId);
    expect(await row(command.id)).toMatchObject({ status: 'DONE', result: { late: true } });
  });

  it('records the outcome the applier reports', async () => {
    const agent = await connect();
    applier.mockResolvedValue({ status: 'FAILED', errorCode: 'PAPER_OUT', errorMessage: 'out of paper' });
    const command = await enqueue();
    await agent.next((m) => m.id === command.id);
    agent.send('test.result', {}, undefined, command.id);
    await until(async () => (await row(command.id)).status === 'FAILED');
    expect(await row(command.id)).toMatchObject({ error_code: 'PAPER_OUT', error_message: 'out of paper' });
  });

  it('rolls back when applying fails, answers INTERNAL, and applies the resent result', async () => {
    const agent = await connect();
    applier.mockRejectedValueOnce(new Error('db hiccup')).mockResolvedValueOnce(undefined);
    const command = await enqueue();
    await agent.next((m) => m.id === command.id);
    agent.send('ack', { ok: true }, undefined, command.id);
    await until(async () => (await row(command.id)).status === 'ACKED');

    const resultId = agent.send('test.result', {}, undefined, command.id);
    const refused = await agent.next((m) => m.ref === resultId);
    expect(refused.payload).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect((await row(command.id)).status).toBe('ACKED');

    agent.frames.length = 0;
    agent.send('test.result', {}, resultId, command.id);
    await agent.next((m) => m.ref === resultId && m.payload.ok === true);
    expect((await row(command.id)).status).toBe('DONE');
  });

  it("refuses a result of the wrong kind, and never touches another branch's command", async () => {
    const agent = await connect();
    const command = await enqueue('payment.charge', { amount: '1000' });
    await agent.next((m) => m.id === command.id);
    const wrong = agent.send('test.result', {}, undefined, command.id);
    await expect(agent.next((m) => m.ref === wrong)).resolves.toMatchObject({
      payload: { ok: false, error: { code: 'INVALID_PAYLOAD' } },
    });

    const elsewhere = await commands.enqueue(tenantId, otherBranchId, 'test.job', {});
    agent.send('ack', { ok: true }, undefined, elsewhere.id);
    const foreign = agent.send('test.result', {}, undefined, elsewhere.id);
    await agent.next((m) => m.ref === foreign);
    const untouched = await row(elsewhere.id);
    expect(untouched).toMatchObject({ status: 'QUEUED', agent_id: null });
    expect(applier).not.toHaveBeenCalled();
    expect(agent.frames.some((m) => m.id === elsewhere.id)).toBe(false);
  });
});
