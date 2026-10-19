import { CanActivate, ConflictException, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** The header a device sends with its own id, beside the register it is set up as. */
export const DEVICE_ID_HEADER = 'x-device-id';

const SKIP_DEVICE_CHECK_KEY = 'skipRegisterDeviceCheck';
/** For the route that pairs a device, and signing in and out: they work on a device that is not paired. */
export const SkipRegisterDeviceCheck = () => SetMetadata(SKIP_DEVICE_CHECK_KEY, true);

const CHECK_READ_KEY = 'checkRegisterDeviceOnRead';
/** A read the till makes as the register, such as its open shift: refused, like a write, for a device that is not paired. */
export const CheckRegisterDeviceOnRead = () => SetMetadata(CHECK_READ_KEY, true);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Seen more often than this is not written again: a till makes a request every few seconds. */
const SEEN_EVERY_MS = 60_000;

/**
 * A register answers only to the device it is paired with.
 *
 * A till sends the register it is set up as (`X-Terminal-Id`) and its own device id
 * (`X-Device-Id`) on every request. When the register is paired with another device, or with
 * none since a manager unpaired it, a write is refused with `REGISTER_DEVICE_UNPAIRED`, as is
 * the till's own check for its open shift, and the till forgets the register and asks a manager
 * to set it up again. That is how a lost or retired PC is cut off without archiving the register
 * its replacement needs. Other reads pass, so the app still loads around the setup prompt.
 *
 * A request without a device id (tests, scripts, an app build from before pairing) is left
 * alone, as is a kiosk, which is V3. A register that no longer exists is too: the till finds
 * out it was archived from the register list.
 */
@Injectable()
export class RegisterDeviceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const terminalId: string | null = req?.tillTerminalId ?? null;
    const raw = req?.headers?.[DEVICE_ID_HEADER];
    const deviceId = typeof raw === 'string' && UUID.test(raw.trim()) ? raw.trim().toLowerCase() : null;
    if (!terminalId || !deviceId || !req.tenantId) return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_DEVICE_CHECK_KEY, targets)) return true;
    const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'GET').toUpperCase());
    const checkRead = this.reflector.getAllAndOverride<boolean>(CHECK_READ_KEY, targets);

    const [row] = await this.dataSource.query(
      `SELECT name, code, terminal_type, device_id, last_seen_at
         FROM terminal WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [terminalId, req.tenantId],
    );
    if (!row || row.terminal_type !== 'CASHIER') return true;

    if (row.device_id !== deviceId && (!isRead || checkRead)) {
      throw new ConflictException({
        code: 'REGISTER_DEVICE_UNPAIRED',
        title: 'Register not paired',
        detail: `This device is no longer set up as ${row.name} (${row.code}). A manager can set it up again.`,
      });
    }

    if (row.device_id !== deviceId) return true;

    const seen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (Date.now() - seen > SEEN_EVERY_MS) {
      // Nobody waits on it: a missed write only makes "last seen" a minute older.
      this.dataSource
        .query(`UPDATE terminal SET last_seen_at = now() WHERE id = $1 AND device_id = $2`, [terminalId, deviceId])
        .catch(() => undefined);
    }
    return true;
  }
}
