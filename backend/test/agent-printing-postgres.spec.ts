import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Printer } from '../src/entities/Printer.entity';
import { PrintJob } from '../src/entities/PrintJob.entity';
import { PrintAttempt } from '../src/entities/PrintAttempt.entity';
import { AgentCommand } from '../src/entities/AgentCommand.entity';
import { OperationalAlert } from '../src/entities/OperationalAlert.entity';
import { AgentEnrolmentService } from '../src/modules/agent-gateway/agent-enrolment.service';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { AgentCommandsService } from '../src/modules/agent-gateway/agent-commands.service';
import { AgentConfigService } from '../src/modules/agent-gateway/agent-config.service';
import { PrintQueueService } from '../src/modules/printing/print-queue.service';
import { parseDeviceConnection } from '../src/common/utils/device-connection.util';
import { deleteTenantData } from './utils/tenant-teardown';
import { TestAgent } from './utils/agent-client';

const until = async (check: () => Promise<boolean> | boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
};

// Printing through a (test) branch agent, from the print queue to the printer and back.
describe('printing via the branch agent (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let queue: PrintQueueService;
  let commands: AgentCommandsService;
  let agentConfig: AgentConfigService;
  let wsUrl: string;
  let tenantId: string;
  let branchId: string;
  let deviceKey: string;
  let agentPrinterId: string;
  let simPrinterId: string;
  const open: TestAgent[] = [];

  const jobs = () => dataSource.getRepository(PrintJob);
  const attemptsOf = (jobId: string) =>
    dataSource.getRepository(PrintAttempt).find({ where: { job_id: jobId }, order: { attempt_no: 'ASC' } });
  const job = (id: string) => jobs().findOneByOrFail({ id });
  const connect = async () => {
    const agent = new TestAgent(wsUrl, deviceKey);
    open.push(agent);
    const welcome = await agent.handshake();
    return { agent, welcome };
  };
  /** An order's original chit; a reprint of it is a fresh job on the same printer. */
  const seedJob = (printerId: string, documentType = 'KITCHEN_TICKET') =>
    jobs().save(
      jobs().create({
        tenant_id: tenantId,
        branch_id: branchId,
        document_type: documentType,
        entity_type: 'Order',
        entity_id: '00000000-0000-4000-8000-000000000001',
        printer_id: printerId,
        label: 'Grill',
        status: 'SUCCESS',
        copies: 2,
        rendered_html: '<html><body>سفارش ۱۲</body></html>',
      }),
    );
  const reprint = async (printerId: string, documentType?: string) => {
    const [printed] = await queue.reprintJob(tenantId, (await seedJob(printerId, documentType)).id, 'test');
    return printed;
  };
  const answer = (agent: TestAgent, command: any, status: 'SUCCESS' | 'FAILED', error?: any) => {
    agent.send('ack', { ok: true }, undefined, command.id);
    return agent.send(
      'print.result',
      {
        job_id: command.payload.job_id,
        attempt_no: command.payload.attempt_no,
        printer_id: command.payload.printer_id,
        status,
        copies_printed: status === 'SUCCESS' ? command.payload.copies : 0,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        error: error ?? null,
      },
      undefined,
      command.id,
    );
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    wsUrl = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/agent/ws`;
    dataSource = moduleRef.get(DataSource);
    queue = moduleRef.get(PrintQueueService);
    commands = moduleRef.get(AgentCommandsService);
    agentConfig = moduleRef.get(AgentConfigService);

    const save = <T>(entity: any, data: Partial<T>) =>
      dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
    tenantId = (
      await save(Tenant, { code: `AGENTPRN-${Date.now()}`, name: 'Agent print fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'APR', name: 'Print branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    agentPrinterId = (
      await save(Printer, {
        tenant_id: tenantId,
        branch_id: branchId,
        code: 'KIT',
        name: 'Kitchen',
        printer_type: 'KITCHEN_IMPACT',
        is_active: true,
        agent_connection: { kind: 'tcp', host: '192.168.1.50', port: 9100 },
      })
    ).id;
    simPrinterId = (await save(Printer, { tenant_id: tenantId, branch_id: branchId, code: 'SIM', name: 'Simulated', is_active: true })).id;

    const registry = moduleRef.get(AgentRegistryService);
    const { code } = await registry.createEnrolmentCode(tenantId, branchId, {});
    deviceKey = (await moduleRef.get(AgentEnrolmentService).enrol({ code }, { clientKey: 'test', wsUrl: '' })).device_key;
  }, 60000);

  afterEach(async () => {
    for (const a of open.splice(0)) {
      a.ws.terminate();
      await a.closed;
    }
    await dataSource.getRepository(AgentCommand).update({ tenant_id: tenantId, status: 'QUEUED' }, { status: 'DONE' });
    await dataSource.getRepository(AgentCommand).update({ tenant_id: tenantId, status: 'SENT' }, { status: 'DONE' });
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('tells the agent which printers are its own', async () => {
    const { welcome } = await connect();
    const printers = welcome.payload.config.printers;
    expect(printers.find((p: any) => p.id === agentPrinterId).connection).toEqual({ kind: 'tcp', host: '192.168.1.50', port: 9100 });
    expect(printers.find((p: any) => p.id === simPrinterId).connection).toBeNull();
  });

  it('prints on an agent printer through the agent, and settles on its result', async () => {
    const { agent } = await connect();
    const printed = await reprint(agentPrinterId);
    expect(printed.status).toBe('PROCESSING');

    const command = await agent.next((m) => m.type === 'print.job');
    expect(command.payload).toMatchObject({
      job_id: printed.id,
      attempt_no: 1,
      printer_id: agentPrinterId,
      document_type: 'KITCHEN_TICKET',
      label: 'Grill',
      copies: 2,
      content: { format: 'html', html: '<html><body>سفارش ۱۲</body></html>' },
    });
    expect(Date.parse(command.payload.expires_at) - Date.now()).toBeGreaterThan(29 * 60_000);
    const [pending] = await attemptsOf(printed.id);
    expect(pending).toMatchObject({ status: 'PENDING', agent_command_id: command.id });

    const resultId = answer(agent, command, 'SUCCESS');
    await agent.next((m) => m.type === 'ack' && m.ref === resultId);

    expect(await job(printed.id)).toMatchObject({ status: 'SUCCESS' });
    expect((await job(printed.id)).completed_at).toBeInstanceOf(Date);
    expect((await attemptsOf(printed.id))[0]).toMatchObject({ status: 'SUCCESS', error_code: null });
  });

  it('keeps the simulator for a printer the agent does not drive', async () => {
    const { agent } = await connect();
    const printed = await reprint(simPrinterId);
    expect(printed.status).toBe('SUCCESS');
    await new Promise((r) => setTimeout(r, 150));
    expect(agent.frames.some((m) => m.type === 'print.job')).toBe(false);
  });

  it('fails the job and raises a critical alert when the kitchen printer is out of paper, then retries for real', async () => {
    const { agent } = await connect();
    const printed = await reprint(agentPrinterId);
    const first = await agent.next((m) => m.type === 'print.job' && m.payload.job_id === printed.id);

    const resultId = answer(agent, first, 'FAILED', { code: 'PAPER_OUT', message: 'Paper end' });
    await agent.next((m) => m.ref === resultId);

    expect(await job(printed.id)).toMatchObject({ status: 'FAILED' });
    expect((await attemptsOf(printed.id))[0]).toMatchObject({ status: 'FAILED', error_code: 'PAPER_OUT', error_message: 'Paper end' });
    const alert = await dataSource
      .getRepository(OperationalAlert)
      .findOneByOrFail({ tenant_id: tenantId, branch_id: branchId, type: 'PRINT_FAILED', acknowledged: false });
    expect(alert).toMatchObject({ severity: 'CRITICAL', title: 'Printer Kitchen failed' });
    expect(alert.message).toContain('PAPER_OUT');

    await queue.retryJob(tenantId, printed.id, { reason: 'paper loaded' });
    const second = await agent.next((m) => m.type === 'print.job' && m.payload.job_id === printed.id && m.payload.attempt_no === 2);
    expect(second.id).not.toBe(first.id);
    expect(await job(printed.id)).toMatchObject({ status: 'PROCESSING' });
    answer(agent, second, 'SUCCESS');
    await until(async () => (await job(printed.id)).status === 'SUCCESS');
  });

  it('keeps a job for an offline agent, and a retry takes back what never left', async () => {
    const printed = await reprint(agentPrinterId);
    const [waiting] = await attemptsOf(printed.id);
    expect(waiting.status).toBe('PENDING');
    expect(await commands.get(waiting.agent_command_id!)).toMatchObject({ status: 'QUEUED' });

    await queue.retryJob(tenantId, printed.id, {});
    const [withdrawn, resent] = await attemptsOf(printed.id);
    expect(withdrawn).toMatchObject({ status: 'FAILED', error_code: 'WITHDRAWN' });
    expect(resent).toMatchObject({ status: 'PENDING', attempt_no: 2 });

    const { agent } = await connect();
    const delivered = await agent.next((m) => m.type === 'print.job' && m.payload.job_id === printed.id);
    expect(delivered).toMatchObject({ id: resent.agent_command_id, payload: { attempt_no: 2 } });
    await new Promise((r) => setTimeout(r, 150));
    expect(agent.frames.filter((m) => m.type === 'print.job' && m.payload.job_id === printed.id)).toHaveLength(1);
  });

  it('refuses a retry while the agent may be printing the job', async () => {
    const { agent } = await connect();
    const printed = await reprint(agentPrinterId);
    await agent.next((m) => m.type === 'print.job' && m.payload.job_id === printed.id);
    await until(async () => (await commands.get((await attemptsOf(printed.id))[0].agent_command_id!))!.status === 'SENT');

    await expect(queue.retryJob(tenantId, printed.id, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(await attemptsOf(printed.id)).toHaveLength(1);
  });

  it('fails the attempt when the agent refuses the job or never takes it', async () => {
    const { agent } = await connect();
    const refused = await reprint(agentPrinterId, 'CUSTOMER_RECEIPT');
    const command = await agent.next((m) => m.type === 'print.job' && m.payload.job_id === refused.id);
    agent.send('ack', { ok: false, error: { code: 'DEVICE_NOT_CONFIGURED', message: 'unknown printer' } }, undefined, command.id);
    await until(async () => (await job(refused.id)).status === 'FAILED');
    expect((await attemptsOf(refused.id))[0]).toMatchObject({ error_code: 'DEVICE_NOT_CONFIGURED' });

    agent.ws.terminate();
    await agent.closed;
    const stale = await reprint(agentPrinterId, 'CUSTOMER_RECEIPT');
    await commands.tick(new Date(Date.now() + 31 * 60_000));
    await until(async () => (await job(stale.id)).status === 'FAILED');
    expect((await attemptsOf(stale.id))[0]).toMatchObject({ status: 'FAILED', error_code: 'EXPIRED' });
  });

  it('sends the agent the new printer list when a printer changes', async () => {
    const { agent } = await connect();
    await dataSource.getRepository(Printer).update({ id: simPrinterId }, { agent_connection: { kind: 'windows', printer_name: 'EPSON TM-T20III' } });

    await agentConfig.pushToBranch(tenantId, branchId);

    const update = await agent.next((m) => m.type === 'config.updated');
    expect(update.payload.printers.find((p: any) => p.id === simPrinterId).connection).toEqual({
      kind: 'windows',
      printer_name: 'EPSON TM-T20III',
    });
    agent.send('ack', { ok: true }, undefined, update.id);
    await until(async () => (await commands.get(update.id))!.status === 'DONE');

    await dataSource.getRepository(Printer).update({ id: simPrinterId }, { agent_connection: null });
  });

  it('accepts only complete printer connections', () => {
    const allowed: any[] = ['tcp', 'windows', 'serial'];
    expect(parseDeviceConnection(null, allowed)).toBeNull();
    expect(parseDeviceConnection({ kind: 'none' }, allowed)).toBeNull();
    expect(parseDeviceConnection({ kind: 'tcp', host: ' 192.168.1.50 ', port: '9100' }, allowed)).toEqual({
      kind: 'tcp',
      host: '192.168.1.50',
      port: 9100,
    });
    expect(parseDeviceConnection({ kind: 'serial', port: 'com3', baud: 115200 }, allowed)).toEqual({ kind: 'serial', port: 'COM3', baud: 115200 });
    for (const bad of [
      { kind: 'tcp', host: '', port: 9100 },
      { kind: 'tcp', host: 'x', port: 70000 },
      { kind: 'tcp', host: 'bad host', port: 9100 },
      { kind: 'windows', printer_name: '' },
      { kind: 'serial', port: '/dev/tty0', baud: 9600 },
      { kind: 'serial', port: 'COM1', baud: 1234 },
      { kind: 'usb' },
      'tcp',
    ]) {
      expect(() => parseDeviceConnection(bad, allowed)).toThrow(BadRequestException);
    }
    expect(() => parseDeviceConnection({ kind: 'windows', printer_name: 'x' }, ['tcp'])).toThrow(BadRequestException);
  });
});
