import { httpClient } from './httpClient';

export type TaxInvoiceStatus = 'QUEUED' | 'PENDING' | 'SUCCESS' | 'FAILED';

/** One Moadian e-invoice. The tax office's side of the exchange is simulated in the prototype. */
export interface TaxInvoice {
  id: string;
  branch_id: string | null;
  order_id: string;
  order_number: string | null;
  refund_id: string | null;
  /** 1 original, 3 cancellation, 4 return from sale. */
  subject: 1 | 3 | 4;
  tax_id: string;
  serial: number;
  reference_tax_id: string | null;
  status: TaxInvoiceStatus;
  reference_number: string | null;
  total_amount: string;
  vat_amount: string;
  payload: { header: Record<string, unknown>; body: Record<string, unknown>[]; payments: unknown[] };
  errors: { code: string; message: string }[] | null;
  attempts: number;
  issued_at: string;
  sent_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

/** The MOADIAN settings group, owned by head office. */
export interface MoadianSettings {
  enabled: boolean;
  memoryId: string;
  economicCode: string;
  defaultSstid: string;
  unitCode: string;
  rejectionRate: number;
  enabledAt: string | null;
}

export const MOADIAN_SETTINGS_DEFAULTS: MoadianSettings = {
  enabled: false,
  memoryId: '',
  economicCode: '',
  defaultSstid: '2720000114542',
  unitCode: '1627',
  rejectionRate: 0,
  enabledAt: null,
};

export const moadianApi = {
  list: async (
    params: { status?: string; branchId?: string; orderId?: string } = {}
  ): Promise<{ items: TaxInvoice[]; counts: Partial<Record<TaxInvoiceStatus, number>> }> => {
    const res = await httpClient.get('/api/v1/moadian/invoices', { params });
    return res.data;
  },

  /** Issue the original invoice for a completed, paid order by hand. */
  issue: async (orderId: string): Promise<TaxInvoice> => {
    const res = await httpClient.post(`/api/v1/moadian/orders/${orderId}/issue`);
    return res.data;
  },

  retry: async (invoiceId: string): Promise<TaxInvoice> => {
    const res = await httpClient.post(`/api/v1/moadian/invoices/${invoiceId}/retry`);
    return res.data;
  },

  /** Run the send-and-answer cycle now rather than waiting for the background timer. */
  process: async (): Promise<{ queued: number; sent: number; answered: number }> => {
    const res = await httpClient.post('/api/v1/moadian/process');
    return res.data;
  },
};
