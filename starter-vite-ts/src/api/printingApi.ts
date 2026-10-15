import { httpClient } from './httpClient';

/** How the branch agent reaches a printer. None means the printer is simulated. */
export type PrinterConnection =
  | { kind: 'tcp'; host: string; port: number }
  | { kind: 'windows'; printer_name: string }
;

export interface PrinterDevice {
  branch_id?: string;
  id: string;
  code: string;
  name: string;
  printer_type: string;
  simulated_address?: string;
  paper_width_mm: number;
  is_active: boolean;
  /** The branch's one printer for kitchen lines nothing routes anywhere else. */
  kitchen_default?: boolean;
  /** The branch's one printer for the receipts of a till with no printer of its own (K-23). */
  receipt_default?: boolean;
  /** Prints every order whole on one more chit, for the pass. */
  prints_whole_order?: boolean;
  agent_connection?: PrinterConnection | null;
  /** Whether the branch agent has taken this printer's current settings; null when it does not drive it. */
  agent_ready?: boolean | null;
}

/** What one printer prints: whole categories, and single products. A null printer is the "not printed" list. */
export interface PrinterRoutes {
  printer_id: string | null;
  category_ids: string[];
  product_ids: string[];
}

/** Why a menu item prints where it does. */
export type RouteSource = 'PRODUCT' | 'CATEGORY' | 'DEFAULT' | 'NOT_PRINTED' | 'NOWHERE';

export interface ProductRouting {
  product_id: string;
  source: RouteSource;
  printer_ids: string[];
}

export interface KitchenChitPreview {
  printer_id: string | null;
  printer_name: string | null;
  /** False for a printer out of service (its chit would fail) or no printer at all. */
  in_service: boolean;
  label: string;
  whole_order: boolean;
  html: string;
}

export interface PrintJob {
  id: string;
  branch_id: string;
  document_type: string;
  entity_type: string;
  entity_id: string;
  printer_id?: string;
  /** The printer a kitchen chit is for, e.g. "Grill (1/3)" when the order was split. */
  label?: string;
  /** PROCESSING: not printed yet; UNCERTAIN: check printer; EXPIRED: a kitchen chit unsent at the cutoff. */
  status: 'QUEUED' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'UNCERTAIN' | 'EXPIRED' | 'REPLACED' | 'DISMISSED' | 'CANCELLED';
  copies: number;
  rendered_html: string;
  is_reprint: boolean;
  reason?: string;
  created_at: string;
  /** Listing only: the order the job printed, the printer's name, and whether it is a real one. */
  order_number?: string | null;
  printer_name?: string | null;
  via_agent?: boolean;
  attempts?: Array<{
    id: string;
    attempt_no: number;
    printer_id: string;
    status: string;
    scenario_id?: string;
    started_at: string;
  }>;
}

export const printingApi = {
  // Printers
  getPrinters: async (branchId?: string): Promise<PrinterDevice[]> => {
    const res = await httpClient.get('/api/v1/printers', { params: { branchId } });
    return res.data;
  },
  createPrinter: async (data: Partial<PrinterDevice>): Promise<PrinterDevice> => {
    const res = await httpClient.post('/api/v1/printers', data);
    return res.data;
  },
  updatePrinter: async (id: string, data: Partial<PrinterDevice>): Promise<PrinterDevice> => {
    const res = await httpClient.patch(`/api/v1/printers/${id}`, data);
    return res.data;
  },
  deletePrinter: async (id: string): Promise<any> => {
    const res = await httpClient.delete(`/api/v1/printers/${id}`);
    return res.data;
  },

  // Print routing
  getPrintRoutes: async (branchId: string): Promise<PrinterRoutes[]> => {
    const res = await httpClient.get('/api/v1/print-routes', { params: { branchId } });
    return res.data;
  },
  /** Replaces everything the printer prints. */
  setPrinterRoutes: async (printerId: string, data: { category_ids: string[]; product_ids: string[] }): Promise<PrinterRoutes> => {
    const res = await httpClient.put(`/api/v1/printers/${printerId}/routes`, data);
    return res.data;
  },
  /** Replaces what prints in no kitchen at the branch. */
  setNotPrinted: async (branchId: string, data: { category_ids: string[]; product_ids: string[] }): Promise<PrinterRoutes> => {
    const res = await httpClient.put('/api/v1/print-routes/not-printed', { branch_id: branchId, ...data });
    return res.data;
  },
  getMenuRouting: async (branchId: string): Promise<ProductRouting[]> => {
    const res = await httpClient.get('/api/v1/print-routes/by-product', { params: { branchId } });
    return res.data;
  },
  /** The chits a made-up order would print. Nothing is printed or queued. */
  previewKitchenChits: async (data: {
    branch_id: string;
    product_ids: string[];
    order_type?: string;
    notes?: string;
  }): Promise<{ chits: KitchenChitPreview[]; not_printed: string[] }> => {
    const res = await httpClient.post('/api/v1/print-routes/preview', data);
    return res.data;
  },
  setKitchenDefault: async (printerId: string): Promise<PrinterDevice> => {
    const res = await httpClient.post(`/api/v1/printers/${printerId}/kitchen-default`);
    return res.data;
  },
  setReceiptDefault: async (printerId: string): Promise<PrinterDevice> => {
    const res = await httpClient.post(`/api/v1/printers/${printerId}/receipt-default`);
    return res.data;
  },

  // Print jobs & simulator outcome
  getPrintJobs: async (params?: { branchId?: string; status?: string; documentType?: string; entityId?: string; limit?: number; offset?: number }): Promise<{ items: PrintJob[]; total: number }> => {
    const res = await httpClient.get('/api/v1/print-jobs', { params });
    return res.data;
  },
  /** Sends a test page through the branch agent; poll the returned job for the printer's answer. */
  testPrint: async (printerId: string): Promise<PrintJob> => {
    const res = await httpClient.post(`/api/v1/printers/${printerId}/test-print`);
    return res.data;
  },
  getPrintJobById: async (id: string): Promise<PrintJob> => {
    const res = await httpClient.get(`/api/v1/print-jobs/${id}`);
    return res.data;
  },
  simulatePrintOutcome: async (data: { printJobId: string; scenarioId?: string; outcome: 'SUCCESS' | 'FAILED' }): Promise<any> => {
    const res = await httpClient.post('/api/v1/simulation/printers/outcome', data);
    return res.data;
  },
  retryPrintJob: async (id: string, data?: { scenarioId?: string }): Promise<any> => {
    const res = await httpClient.post(`/api/v1/print-jobs/${id}/retry`, data || {});
    return res.data;
  },
  /** The cashier saw the paper of a "check printer" or expired job. */
  confirmPrintJob: async (id: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/print-jobs/${id}/confirm`, {});
    return res.data;
  },
  /** Set an expired (or failed, or unsure) job aside, with the reason. */
  dismissPrintJob: async (id: string, reason: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/print-jobs/${id}/dismiss`, { reason });
    return res.data;
  },
  /** `printerId` redirects the copy to another device — the usual one has died. */
  reprintJob: async (id: string, reason?: string, printerId?: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/print-jobs/${id}/reprint`, { reason, printerId });
    return res.data;
  },
  reprintOrder: async (
    orderId: string,
    documentType = 'CUSTOMER_RECEIPT',
    reason?: string,
    printerId?: string,
    /** One printer's kitchen chit only. */
    onlyPrinterId?: string
  ): Promise<any> => {
    const res = await httpClient.post(`/api/v1/orders/${orderId}/reprint`, {
      documentType,
      reason,
      printerId,
      onlyPrinterId,
    });
    return res.data;
  },
};
