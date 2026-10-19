import { AgentConnectionHandle, AgentQueryError, AgentSessionsService } from '../src/modules/agent-gateway/agent-sessions.service';

// Live queries (protocol §20): the cloud asks, the agent answers once with agent.query.result,
// and nothing is stored. What happens when the answer comes, fails, is late or never comes.
describe('Agent live queries', () => {
  const handle = (capabilities: string[] = ['agent.query'], open = true) => {
    const sent: any[] = [];
    const h: AgentConnectionHandle = {
      agentId: 'agent-1',
      tenantId: 't',
      branchId: 'b',
      sessionId: 's',
      agentVersion: '2.5.0',
      capabilities,
      connectedAt: new Date(),
      send: (m) => {
        sent.push(m);
        return open;
      },
      close: () => undefined,
    };
    return { h, sent };
  };

  it('sends agent.query and resolves with the data of the answer that refs it', async () => {
    const sessions = new AgentSessionsService();
    const { h, sent } = handle();
    sessions.register(h);
    const asked = sessions.query(h, 'scan', { port: 9100 });
    expect(sent[0].type).toBe('agent.query');
    expect(sent[0].payload).toMatchObject({ query: 'scan', args: { port: 9100 } });

    // Another agent's answer to the same id is not this one's.
    sessions.answerQuery('agent-2', sent[0].id, { ok: true, data: { found: [] } });
    sessions.answerQuery('agent-1', sent[0].id, { ok: true, data: { found: [{ host: '192.168.1.20', port: 9100 }] } });
    await expect(asked).resolves.toEqual({ found: [{ host: '192.168.1.20', port: 9100 }] });
  });

  it('rejects with what the agent said when it could not do it', async () => {
    const sessions = new AgentSessionsService();
    const { h, sent } = handle();
    sessions.register(h);
    const asked = sessions.query(h, 'logs');
    sessions.answerQuery('agent-1', sent[0].id, { ok: false, error: { code: 'INTERNAL', message: 'no log file' } });
    await expect(asked).rejects.toMatchObject({ code: 'AGENT_QUERY_FAILED', message: 'no log file' });
  });

  it('refuses an agent too old to answer, and one whose socket is closed', async () => {
    const sessions = new AgentSessionsService();
    await expect(sessions.query(handle(['print.html']).h, 'logs')).rejects.toMatchObject({ code: 'AGENT_TOO_OLD' });
    await expect(sessions.query(handle(['agent.query'], false).h, 'logs')).rejects.toMatchObject({ code: 'AGENT_OFFLINE' });
  });

  it('gives up at the timeout, and at once when the agent goes offline', async () => {
    const sessions = new AgentSessionsService();
    const { h } = handle();
    sessions.register(h);
    await expect(sessions.query(h, 'logs', {}, 20)).rejects.toBeInstanceOf(AgentQueryError);

    const pending = sessions.query(h, 'scan', {}, 10_000);
    sessions.unregister(h);
    await expect(pending).rejects.toMatchObject({ code: 'AGENT_OFFLINE' });
  });
});
