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
  agent_connection?: PrinterConnection | null;
}

/** What one printer prints: whole categories, and single products. */
export interface PrinterRoutes {
  printer_id: string;
  category_ids: string[];
  product_ids: string[];
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
  status: 'QUEUED' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
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
  setKitchenDefault: async (printerId: string): Promise<PrinterDevice> => {
    const res = await httpClient.post(`/api/v1/printers/${printerId}/kitchen-default`);
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
