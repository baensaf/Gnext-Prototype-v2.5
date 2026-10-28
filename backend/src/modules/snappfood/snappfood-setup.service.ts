import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Branch } from '../../entities/Branch.entity';
import { SnappfoodConnection, SnappfoodMode, SnappfoodWebhook } from '../../entities/SnappfoodConnection.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { ChannelRefusal } from '../order/channels/channel-adapter';
import { SnappfoodLiveService, isLive } from './snappfood-live.service';

export const SNAPPFOOD_WEBHOOK_PATH = '/api/v1/webhooks/snappfood/';

export type SnappfoodBranchInput = {
  mode: SnappfoodMode;
  vendorCode?: string | null;
  clientId?: string | null;
  /** Left out to keep the one saved. */
  clientSecret?: string;
  username?: string | null;
  /** Left out to keep the one saved. */
  password?: string;
};

const blank = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * The Snappfood settings page: the chain's webhook address and, per branch, which Snappfood it
 * talks to and with what account. Secrets go in and never come back out; the page only learns
 * whether one is saved.
 */
@Injectable()
export class SnappfoodSetupService {
  constructor(
    @InjectRepository(SnappfoodWebhook) private readonly webhooks: Repository<SnappfoodWebhook>,
    @InjectRepository(SnappfoodConnection) private readonly connections: Repository<SnappfoodConnection>,
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    private readonly live: SnappfoodLiveService,
    private readonly auditWriter: AuditWriter,
  ) {}

  async getSetup(tenantId: string) {
    const webhook = await this.webhook(tenantId);
    const branches = await this.branches.find({ where: { tenant_id: tenantId, is_active: true }, order: { created_at: 'ASC' } });
    const conns = await this.connections.find({ where: { tenant_id: tenantId } });
    return {
      webhook: {
        path: SNAPPFOOD_WEBHOOK_PATH + webhook.token,
        hmac_set: !!webhook.hmac_secret,
        last_received_at: webhook.last_received_at,
      },
      branches: branches.map((b) => {
        const c = conns.find((x) => x.branch_id === b.id);
        return {
          branch_id: b.id,
          name: b.name,
          mode: c?.mode ?? 'SIMULATED',
          vendor_code: c?.vendor_code ?? null,
          client_id: c?.client_id ?? null,
          username: c?.username ?? null,
          has_client_secret: !!c?.client_secret,
          has_password: !!c?.password,
          live: !!c && isLive(c),
        };
      }),
    };
  }

  /** The chain's webhook row, made with a fresh token the first time anyone asks. */
  async webhook(tenantId: string): Promise<SnappfoodWebhook> {
    const found = await this.webhooks.findOne({ where: { tenant_id: tenantId } });
    if (found) return found;
    return this.webhooks.save(this.webhooks.create({ tenant_id: tenantId, token: newToken(), hmac_secret: null }));
  }

  /** A new address: the old one stops working at once, so Snappfood must be given the new one. */
  async rotateToken(tenantId: string, userId?: string) {
    const webhook = await this.webhook(tenantId);
    webhook.token = newToken();
    await this.webhooks.save(webhook);
    await this.audit(tenantId, userId, 'SNAPPFOOD_WEBHOOK_ROTATED');
    return this.getSetup(tenantId);
  }

  /** Empty clears it: the address alone then authenticates Snappfood's calls. */
  async setHmacSecret(tenantId: string, secret: string | null, userId?: string) {
    const webhook = await this.webhook(tenantId);
    webhook.hmac_secret = blank(secret);
    await this.webhooks.save(webhook);
    await this.audit(tenantId, userId, webhook.hmac_secret ? 'SNAPPFOOD_HMAC_SET' : 'SNAPPFOOD_HMAC_CLEARED');
    return this.getSetup(tenantId);
  }

  async saveBranch(tenantId: string, branchId: string, input: SnappfoodBranchInput, userId?: string) {
    const branch = await this.branches.findOne({ where: { id: branchId, tenant_id: tenantId } });
    if (!branch) throw new NotFoundException('Branch not found');

    const conn =
      (await this.connections.findOne({ where: { tenant_id: tenantId, branch_id: branchId } })) ??
      this.connections.create({ tenant_id: tenantId, branch_id: branchId });
    const vendorCode = blank(input.vendorCode);
    if (vendorCode) {
      const taken = await this.connections.findOne({ where: { tenant_id: tenantId, vendor_code: vendorCode } });
      if (taken && taken.branch_id !== branchId) {
        throw new ConflictException({ code: 'SNAPPFOOD_VENDOR_TAKEN', message: `Vendor code ${vendorCode} belongs to another branch` });
      }
    }

    const accountChanged =
      conn.mode !== input.mode ||
      conn.client_id !== blank(input.clientId) ||
      conn.username !== blank(input.username) ||
      input.clientSecret !== undefined ||
      input.password !== undefined;
    conn.mode = input.mode;
    conn.vendor_code = vendorCode;
    conn.client_id = blank(input.clientId);
    conn.username = blank(input.username);
    if (input.clientSecret !== undefined) conn.client_secret = blank(input.clientSecret);
    if (input.password !== undefined) conn.password = blank(input.password);
    // A token belongs to the account and server it was issued for.
    if (accountChanged) {
      conn.access_token = null;
      conn.token_expires_at = null;
    }
    if (conn.mode !== 'SIMULATED' && !isLive(conn)) {
      throw new BadRequestException({
        code: 'SNAPPFOOD_ACCOUNT_INCOMPLETE',
        message: 'A branch on Snappfood staging or production needs its vendor code, client id and secret, username and password',
      });
    }
    await this.connections.save(conn);
    await this.audit(tenantId, userId, 'SNAPPFOOD_BRANCH_SAVED', branchId, { mode: conn.mode, vendor_code: conn.vendor_code });
    return this.getSetup(tenantId);
  }

  /** Signs in with the branch's account and asks Snappfood for the vendor's status. */
  async testBranch(tenantId: string, branchId: string) {
    const conn = await this.live.connectionFor(tenantId, branchId);
    if (!conn) {
      throw new BadRequestException({ code: 'SNAPPFOOD_NOT_LIVE', message: 'This branch talks to the simulator' });
    }
    try {
      const vendor = await this.live.vendorStatus(conn);
      return { ok: true, status: vendor.status ?? null, vendor_title: vendor.vendorTitle ?? null, vendor_code: vendor.vendorCode ?? null };
    } catch (err) {
      if (err instanceof ChannelRefusal) return { ok: false, code: err.code, message: err.message };
      throw err;
    }
  }

  private async audit(tenantId: string, userId: string | undefined, action: string, entityId?: string, afterData?: any) {
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId,
      action,
      entityType: 'SnappfoodConnection',
      entityId: entityId ?? tenantId,
      afterData,
    });
  }
}

function newToken(): string {
  return crypto.randomBytes(24).toString('hex');
}
