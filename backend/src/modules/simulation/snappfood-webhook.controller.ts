import { Body, Controller, Headers, HttpCode, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Public } from '../../common/decorators/public.decorator';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { SnappfoodConnection, SnappfoodWebhook } from '../../entities/SnappfoodConnection.entity';
import { SimulationService } from './simulation.service';

/** How far Snappfood's HMAC timestamp may be from our clock. */
const HMAC_SKEW_MS = 10 * 60 * 1000;

/**
 * Snappfood's webhook (annex 4.3.0, section 5), the address given to Snappfood for the whole
 * chain. The token in the path says which tenant it is and that the call is Snappfood's; the
 * order's vendorCode says which branch. Snappfood sends the whole order, form-encoded, on every
 * status change, and takes any answer but 200 or 204 as a failure.
 */
@Controller('api/v1/webhooks/snappfood')
export class SnappfoodWebhookController {
  constructor(
    private readonly simulation: SimulationService,
    @InjectRepository(SnappfoodWebhook) private readonly webhooks: Repository<SnappfoodWebhook>,
    @InjectRepository(SnappfoodConnection) private readonly connections: Repository<SnappfoodConnection>,
    @InjectRepository(IntegrationLog) private readonly logs: Repository<IntegrationLog>,
  ) {}

  @Public()
  @Post(':token')
  @HttpCode(200)
  async receive(@Param('token') token: string, @Body() body: any, @Headers('authorization') authorization?: string) {
    const webhook = token ? await this.webhooks.findOne({ where: { token } }) : null;
    if (!webhook) throw new NotFoundException();
    const tenantId = webhook.tenant_id;
    const payload = normalizeWebhookBody(body);

    if (webhook.hmac_secret && !verifySnappfoodHmac(authorization, webhook.hmac_secret)) {
      await this.refuse(tenantId, payload, 'Invalid or missing Snappfood HMAC');
      throw new UnauthorizedException({ code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Invalid Snappfood HMAC' });
    }

    const vendorCode = payload.vendorCode ? String(payload.vendorCode) : '';
    const conn = vendorCode ? await this.connections.findOne({ where: { tenant_id: tenantId, vendor_code: vendorCode } }) : null;
    if (!conn) {
      // Snappfood will try again; the log says which vendor code still needs a branch.
      await this.refuse(tenantId, payload, `No branch has Snappfood vendor code ${vendorCode || '(none)'}`);
      throw new NotFoundException({ code: 'SNAPPFOOD_VENDOR_UNKNOWN', message: `Unknown vendorCode ${vendorCode}` });
    }

    webhook.last_received_at = new Date();
    await this.webhooks.save(webhook);

    const result = await this.simulation.handleSnappfoodWebhook(
      tenantId,
      JSON.stringify(payload),
      { ...payload, branch_id: conn.branch_id },
      undefined,
      undefined,
      undefined,
      `corr-snapp-${payload.code || Date.now()}`,
    );
    return { ok: result.success, duplicate: result.duplicate };
  }

  private async refuse(tenantId: string, payload: any, message: string) {
    await this.logs.save(
      this.logs.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'WEBHOOK_RECEIVED',
        idempotency_key: `${payload.code || 'no-code'}:${payload.statusCode ?? ''}`,
        is_duplicate: false,
        status: 'REJECTED',
        request_payload: payload,
        error_message: message,
      }),
    );
  }
}

/**
 * Snappfood's header: `HMAC snappfood:<timestamp>:<base64(hmac_sha256('POST' + timestamp, secret))>`.
 * The body is not signed. A timestamp far from now is refused, so an old header can't be replayed.
 */
export function verifySnappfoodHmac(header: string | undefined, secret: string, now = Date.now()): boolean {
  const match = /^HMAC\s+snappfood:([^:]+):(.+)$/i.exec(header?.trim() ?? '');
  if (!match) return false;
  const [, timestamp, signature] = match;

  const asNumber = Number(timestamp);
  const ms = Number.isFinite(asNumber) ? (asNumber < 1e12 ? asNumber * 1000 : asNumber) : Date.parse(timestamp);
  if (Number.isFinite(ms) && Math.abs(now - ms) > HMAC_SKEW_MS) return false;

  const expected = Buffer.from(crypto.createHmac('sha256', secret).update('POST' + timestamp).digest('base64'));
  const given = Buffer.from(signature.trim());
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/**
 * The form body as the intake reads it. Express parses `products[0][id]=101` into arrays already,
 * but every value is a string, and an empty field means "not sent": an empty bikerStatusV2 is
 * not a rider update, and an empty orderCoupon is no coupon.
 */
export function normalizeWebhookBody(body: any): any {
  const payload = { ...(body ?? {}) };
  for (const key of ['bikerStatusV2', 'bikerName', 'orderCoupon', 'preOrderTime', 'paidPrice', 'otherDiscounts']) {
    if (payload[key] === '' || payload[key] === null) delete payload[key];
  }
  if (payload.products && !Array.isArray(payload.products) && typeof payload.products === 'object') {
    payload.products = Object.values(payload.products);
  }
  return payload;
}
