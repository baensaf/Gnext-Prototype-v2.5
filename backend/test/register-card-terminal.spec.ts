import { BadRequestException } from '@nestjs/common';
import { AgentPaymentsService } from '../src/modules/payment/agent-payments.service';
import { Terminal } from '../src/entities/Terminal.entity';
import { runWithTill } from '../src/common/utils/till-context';

/**
 * Which card terminal (PC-POS) a register's card charge goes to. Each counter has its own
 * terminal beside it; charging the one at the next counter takes the customer's card on a
 * device they are not standing at.
 */
describe('a register charges cards on its own terminal', () => {
  const agentTerminal = (id: string) => ({ id, code: id, is_active: true, agent_connection: { kind: 'tcp' }, agent_driver: 'sep' });
  const payment: any = { tenant_id: 't-1', method_kind: 'CARD', device_id: null };
  const order: any = { id: 'ord-1', branch_id: 'br-1', terminal_id: 'till-order' };

  function setup(tills: Record<string, any>, devices: any[]) {
    const em: any = {
      findOne: jest.fn(async (entity: any, { where }: any) =>
        entity === Terminal ? tills[where.id] ?? null : devices.find((d) => d.id === where.id) ?? null,
      ),
      find: jest.fn(async () => devices),
    };
    const service = new AgentPaymentsService({} as any, {} as any, {} as any, {} as any, {} as any);
    return { em, service };
  }

  it('uses the terminal linked to the register taking the payment', async () => {
    const { em, service } = setup(
      { 'till-2': { id: 'till-2', name: 'Till 2', payment_device_id: 'dev-b' } },
      [agentTerminal('dev-a'), agentTerminal('dev-b')],
    );
    const device = await runWithTill('till-2', () => service.terminalFor(em, payment, order));
    expect(device?.id).toBe('dev-b');
  });

  it('falls back to the register the order was rung on', async () => {
    const { em, service } = setup(
      { 'till-order': { id: 'till-order', name: 'Till 1', payment_device_id: 'dev-a' } },
      [agentTerminal('dev-a'), agentTerminal('dev-b')],
    );
    expect((await service.terminalFor(em, payment, order))?.id).toBe('dev-a');
  });

  it("takes the branch's only terminal when none is linked", async () => {
    const { em, service } = setup({ 'till-order': { id: 'till-order', name: 'Till 1', payment_device_id: null } }, [agentTerminal('dev-a')]);
    expect((await service.terminalFor(em, payment, order))?.id).toBe('dev-a');
  });

  it('refuses to guess between several terminals when none is linked', async () => {
    const { em, service } = setup(
      { 'till-order': { id: 'till-order', name: 'Till 1', payment_device_id: null } },
      [agentTerminal('dev-a'), agentTerminal('dev-b')],
    );
    await expect(service.terminalFor(em, payment, order)).rejects.toThrow(/link one to Till 1/);
  });

  it('refuses a linked terminal the agent cannot reach rather than charging another', async () => {
    const { em, service } = setup(
      { 'till-order': { id: 'till-order', name: 'Till 1', payment_device_id: 'dev-off' } },
      [{ id: 'dev-off', is_active: true, agent_connection: null, agent_driver: null }, agentTerminal('dev-a')],
    );
    await expect(service.terminalFor(em, payment, order)).rejects.toThrow(BadRequestException);
  });
});
