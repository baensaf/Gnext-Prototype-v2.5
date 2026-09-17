import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { HttpException } from '@nestjs/common';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { Repository } from 'typeorm';
import { WebSocket, WebSocketServer } from 'ws';
import { Agent } from '../../entities/Agent.entity';
import { Branch } from '../../entities/Branch.entity';
import { AgentAuthService, deviceKeyFromHeader } from './agent-auth.service';
import { AgentConfigService } from './agent-config.service';
import { AgentConnection } from './agent-connection';
import { AgentMessageHandlers } from './agent-message-handlers.service';
import { AGENT_CLOSE, MAX_FRAME_BYTES } from './agent-protocol';
import { AgentSessionsService } from './agent-sessions.service';
import { AGENT_WS_PATH } from './agent.controller';

/**
 * The agent WebSocket endpoint (protocol §2, §4), on the same HTTP server as the API.
 *
 * A plain `ws` server rather than a Nest gateway: the protocol is its own JSON envelope, not
 * Nest's `{ event, data }`, and the upgrade has to be refused with a real HTTP 401/403 before
 * any socket exists — which is simplest where the upgrade event is handled directly.
 */
@Injectable()
export class AgentWsServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AgentGateway');
  private wss: WebSocketServer | null = null;
  private httpServer: Server | null = null;
  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void this.handleUpgrade(req, socket, head);
  };

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly auth: AgentAuthService,
    private readonly sessions: AgentSessionsService,
    private readonly handlers: AgentMessageHandlers,
    private readonly config: AgentConfigService,
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
  ) {}

  onApplicationBootstrap() {
    const server = this.adapterHost?.httpAdapter?.getHttpServer?.() as Server | undefined;
    if (!server) return;
    this.httpServer = server;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
    server.on('upgrade', this.onUpgrade);
  }

  onApplicationShutdown() {
    this.sessions.closeAll(AGENT_CLOSE.SERVICE_RESTART, 'SERVICE_RESTART');
    this.httpServer?.off('upgrade', this.onUpgrade);
    this.wss?.clients.forEach((ws) => ws.terminate());
    this.wss?.close();
    this.wss = null;
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const path = (req.url || '').split('?')[0];
    if (path !== AGENT_WS_PATH || !this.wss) {
      // Not ours. Nothing else in this app takes upgrades, so do not leave it hanging.
      return rejectUpgrade(socket, 404, 'Not Found');
    }

    let agent: Agent;
    try {
      agent = await this.auth.authenticate(deviceKeyFromHeader(req.headers.authorization));
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 500;
      const code = err instanceof HttpException ? (err.getResponse() as any)?.code : 'INTERNAL';
      return rejectUpgrade(socket, status, code || 'Unauthorized');
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws, agent));
  }

  private attach(ws: WebSocket, agent: Agent) {
    const connection = new AgentConnection(
      {
        send: (data) => ws.send(data),
        close: (code, reason) => ws.close(code, reason),
        isOpen: () => ws.readyState === WebSocket.OPEN,
      },
      agent,
      {
        sessions: this.sessions,
        handlers: this.handlers,
        loadConfig: (a) => this.config.forBranch(a.tenant_id, a.branch_id),
        branchName: async (a) =>
          (await this.branchRepo.findOne({ where: { id: a.branch_id, tenant_id: a.tenant_id }, withDeleted: true }))?.name ?? null,
        recordHello: (a, info) => this.recordHello(a, info),
        touch: (a) => this.auth.touch(a),
        minAgentVersion: process.env.AGENT_MIN_VERSION || null,
        log: (m) => this.logger.warn(m),
      },
    );

    // Frames are handled one at a time, in order: a result must never overtake the ack before it.
    let queue: Promise<void> = Promise.resolve();
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        connection.close(1003, 'BINARY_NOT_SUPPORTED');
        return;
      }
      const raw = data.toString();
      queue = queue
        .then(() => connection.onFrame(raw))
        .catch((err) => {
          this.logger.error(`agent ${agent.id}: ${err?.message || err}`);
          connection.close(1011, 'INTERNAL');
        });
    });
    ws.on('close', () => connection.onClosed());
    ws.on('error', (err) => {
      this.logger.warn(`agent ${agent.id} socket error: ${err.message}`);
      connection.onClosed();
    });
  }

  private async recordHello(agent: Agent, info: { agentVersion: string | null; protocolVersion: number }) {
    const now = new Date();
    const result = await this.agentRepo.update(
      { id: agent.id, status: 'ACTIVE' },
      { agent_version: info.agentVersion, protocol_version: info.protocolVersion, last_seen_at: now },
    );
    if (!result.affected) return false;
    agent.agent_version = info.agentVersion;
    agent.protocol_version = info.protocolVersion;
    agent.last_seen_at = now;
    return true;
  }
}

function rejectUpgrade(socket: Duplex, status: number, reason: string) {
  const text = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found' }[status] || 'Error';
  const body = JSON.stringify({ status, code: reason });
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  );
  socket.destroy();
}
