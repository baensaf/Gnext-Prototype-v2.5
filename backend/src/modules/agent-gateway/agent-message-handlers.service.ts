import { Injectable } from '@nestjs/common';
import { AgentError, Envelope } from './agent-protocol';
import { AgentConnectionHandle } from './agent-sessions.service';

/**
 * What a handler tells the gateway to answer. `ok: true` acks the message; an error acks it
 * with `ok: false`. `null` means the handler answered itself and no ack is sent.
 */
export type AgentHandlerResult = { ok: true } | { ok: false; error: AgentError } | null;

export type AgentMessageHandler = (message: Envelope, connection: AgentConnectionHandle) => Promise<AgentHandlerResult> | AgentHandlerResult;

/**
 * Where the modules that act on agent messages plug in: command delivery takes `ack`,
 * printing takes `print.result`, payments take `payment.result`. The gateway itself only
 * handles the handshake and heartbeats.
 */
@Injectable()
export class AgentMessageHandlers {
  private readonly handlers = new Map<string, AgentMessageHandler>();

  register(type: string, handler: AgentMessageHandler): void {
    if (this.handlers.has(type)) throw new Error(`An agent handler for "${type}" is already registered`);
    this.handlers.set(type, handler);
  }

  get(type: string): AgentMessageHandler | undefined {
    return this.handlers.get(type);
  }
}
