import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { SessionService } from '../auth/session.service';
import { LiveChange, LiveChangesService, RESYNC_TOPIC } from './live-changes.service';

/** Under the idle timeouts of nginx (60 s) and the CDN in front of it. */
const HEARTBEAT_MS = 20_000;
/** A stream outlives the request that opened it, so the session is re-checked while it runs. */
const SESSION_CHECK_MS = 60_000;

/**
 * Whether a stream should hear about a change.
 *
 * Only the caller's own tenant, only the boards it asked for, and — when both the row and
 * the stream name a branch — only that branch. A row with no branch column (a delivery
 * belongs to its order's shop) reaches every stream of the tenant; the page re-reads
 * through its usual endpoint, which does the branch check.
 */
export function shouldForward(change: LiveChange, tenantId: string, topics: Set<string>, branchId: string | null): boolean {
  if (change.topic === RESYNC_TOPIC) return true;
  if (change.tenant_id !== tenantId) return false;
  if (!topics.has(change.topic)) return false;
  if (branchId && change.branch_id && change.branch_id !== branchId) return false;
  return true;
}

@Controller('api/v1/live')
export class LiveController {
  constructor(
    private readonly live: LiveChangesService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * A Server-Sent Events stream: one `change` event naming the board each time its rows
   * change. It carries no data; the page re-reads through its usual endpoint.
   *
   * `branchId` has already been confined to the caller's own shop for branch accounts
   * (BranchScopeInterceptor).
   */
  @Get('stream')
  stream(
    @Query('topics') topicsParam: string,
    @Query('branchId') branchId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const tenantId = (req as any).tenantId as string;
    const rawToken = (req as any).rawSessionToken as string;
    const topics = new Set(String(topicsParam || '').split(',').map((t) => t.trim()).filter(Boolean));

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // nginx would otherwise hold events in its buffer until it fills.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);

    res.write('retry: 5000\n\n');
    res.write('event: ready\ndata: {}\n\n');

    const subscription = this.live.changes.subscribe((change) => {
      if (!shouldForward(change, tenantId, topics, branchId || null)) return;
      res.write(`event: change\ndata: ${JSON.stringify({ topic: change.topic })}\n\n`);
    });

    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    const sessionCheck = setInterval(async () => {
      const session = await this.sessions.findValidSession(rawToken).catch(() => null);
      if (!session) close();
    }, SESSION_CHECK_MS);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      subscription.unsubscribe();
      clearInterval(heartbeat);
      clearInterval(sessionCheck);
      res.end();
    };
    req.on('close', close);
  }
}
