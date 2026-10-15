import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { TaraFailure, TaraNoReply, TaraSimulatorService } from './tara-simulator.service';

export { TaraNoReply } from './tara-simulator.service';

/** What a Tara call came back with: its body, or the error Tara gave. A lost answer is thrown. */
export type TaraResult<T> =
  | { ok: true; body: T; code?: undefined; message?: undefined }
  | { ok: false; body?: undefined; code: number; message: string };

export interface TaraPurchaseAnswer {
  traceNumber: string;
  referenceNumber: string | null;
}
export interface TaraInquiryAnswer extends TaraPurchaseAnswer {
  message: string;
  purchaseTrack: Array<{ amount: number; doTime: string; type: string }>;
}
export interface TaraInvoiceItem {
  name: string;
  code: string;
  count: number;
  unit: number;
  fee: number;
  group: string;
  groupTitle: string;
  made: number;
}
export interface TaraInvoice {
  totalPrice: number;
  invoiceNumber: string;
  vat: number;
  items: TaraInvoiceItem[];
}

/**
 * Gnext's side of Tara's purchase API: one method per service in Tara's document, sending the
 * path and body it documents with the token as a bearer `authorization` header. Each call is
 * written to the integration log, so the Simulation page shows the flow as it went.
 *
 * The prototype talks to the simulated Tara; a real connection swaps `send` for an HTTP call
 * and keeps everything above it.
 */
@Injectable()
export class TaraClientService {
  private readonly logger = new Logger(TaraClientService.name);

  constructor(
    private readonly sim: TaraSimulatorService,
    private readonly dataSource: DataSource,
  ) {}

  login(tenantId: string, principal: string, password: string) {
    return this.send<{ accessCode: string }>(tenantId, 'Login', '/api/v1/user/login/merchant', null, { principal, password }, () =>
      this.sim.login(tenantId, { principal, password }),
    );
  }

  merchantAccessCode(tenantId: string, token: string, branchCode: string) {
    return this.send<Array<{ accessCode: string; merchantCode: string; terminalCode: string; terminalTitle: string }>>(
      tenantId,
      'MerchantAccessCode',
      `/api/v1/merchant/access/code/${branchCode}`,
      token,
      { branchCode },
      () => this.sim.merchantAccessCode(tenantId, token, branchCode),
    );
  }

  merchandiseGroups(tenantId: string, token: string) {
    return this.send<Array<{ tag: string; id: number; name: string; title: string }>>(
      tenantId,
      'MerchandiseGroup',
      '/api/v1/purchase/merchandise/groups',
      token,
      {},
      () => this.sim.merchandiseGroups(tenantId, token),
    );
  }

  trace(tenantId: string, token: string, terminalCode: string, payment: Array<{ barcode: string; amount: number }>) {
    const body = { terminalCode, payment };
    return this.send<{ mobile: string; traceNumber: string }>(tenantId, 'Trace', `/api/v1/purchase/trace/${terminalCode}`, token, body, () =>
      this.sim.trace(tenantId, token, terminalCode, body),
    );
  }

  request(tenantId: string, token: string, traceNumber: string, amount: number, invoiceData: TaraInvoice) {
    const body = { traceNumber, amount, invoiceNumber: invoiceData.invoiceNumber, invoiceData };
    return this.send<TaraPurchaseAnswer>(tenantId, 'PurchaseRequest', `/api/v1/purchase/request/${traceNumber}`, token, body, () =>
      this.sim.request(tenantId, token, traceNumber, body),
    );
  }

  verify(tenantId: string, token: string, traceNumber: string) {
    return this.send<TaraPurchaseAnswer>(tenantId, 'VerifyPurchase', `/api/v1/purchase/verify/${traceNumber}`, token, { traceNumber }, () =>
      this.sim.verify(tenantId, token, traceNumber),
    );
  }

  reverse(tenantId: string, token: string, traceNumber: string) {
    return this.send<TaraPurchaseAnswer>(tenantId, 'ReversePurchase', `/api/v1/purchase/reverse/${traceNumber}`, token, { traceNumber }, () =>
      this.sim.reverse(tenantId, token, traceNumber),
    );
  }

  inquiry(tenantId: string, token: string, id: string) {
    return this.send<TaraInquiryAnswer>(tenantId, 'InquiryPurchase', `/api/v1/purchase/inquiry/${id}`, token, { id }, () =>
      this.sim.inquiry(tenantId, token, id),
    );
  }

  private async send<T>(
    tenantId: string,
    service: string,
    path: string,
    token: string | null,
    body: any,
    call: () => Promise<any>,
  ): Promise<TaraResult<T>> {
    const request = {
      method: 'POST',
      path,
      headers: token ? { authorization: `Bearer ${token.slice(0, 18)}…` } : {},
      body: body?.password ? { ...body, password: '••••' } : body,
    };
    let response: any;
    try {
      response = await call();
    } catch (err) {
      if (err instanceof TaraNoReply) {
        await this.log(tenantId, service, 'NO_REPLY', request, null, err.message);
        throw err;
      }
      throw err;
    }
    const failure = response && response.success === false ? (response as TaraFailure) : null;
    await this.log(tenantId, service, failure ? 'FAILED' : 'SUCCESS', request, response, failure?.data.message ?? null);
    if (failure) return { ok: false, code: failure.data.code, message: failure.data.message };
    return { ok: true, body: response as T };
  }

  /** Written outside any caller's transaction: the call happened even if the caller rolls back. */
  private async log(tenantId: string, service: string, status: string, request: any, response: any, error: string | null) {
    try {
      await this.dataSource.getRepository(IntegrationLog).save({
        tenant_id: tenantId,
        provider: 'TARA',
        event_type: service,
        status,
        request_payload: request,
        response_payload: response,
        error_message: error,
      } as Partial<IntegrationLog>);
    } catch (err) {
      this.logger.warn(`Could not log Tara ${service}: ${(err as Error)?.message}`);
    }
  }
}
