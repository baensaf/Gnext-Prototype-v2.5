import { httpClient } from './httpClient';

export interface KitchenStation {
  id: string;
  branch_id?: string;
  code: string;
  name: string;
  station_type: string;
  target_minutes: number;
  is_active: boolean;
}

export interface KdsScreen {
  id: string;
  branch_id?: string;
  code: string;
  name: string;
  terminal_id?: string;
  station_ids: string[];
  is_active: boolean;
}

export interface KdsRoutingRule {
  id: string;
  branch_id: string;
  station_id: string;
  product_id?: string;
  category_id?: string;
  priority: number;
}

/** How the branch agent reaches a printer. None means the printer is simulated. */
export type PrinterConnection =
  | { kind: 'tcp'; host: string; port: number }
  | { kind: 'windows'; printer_name: string }
  | { kind: 'serial'; port: string; baud: number };

export interface PrinterDevice {
  id: string;
  code: string;
  name: string;
  printer_type: string;
  simulated_address?: string;
  paper_width_mm: number;
  is_active: boolean;
  fallback_printer_id?: string;
  agent_connection?: PrinterConnection | null;
}

export interface PrinterGroupMember {
  group_id: string;
  printer_id: string;
  priority: number;
  copies: number;
}

export interface PrinterGroup {
  id: string;
  code: string;
  name: string;
  /** The paper this group prints; null takes the document's default. */
  ticket_template?: 'COMPACT' | 'DETAILED' | null;
  members?: PrinterGroupMember[];
}

export interface PrintRoute {
  id: string;
  branch_id?: string;
  document_type: string;
  product_id?: string | null;
  category_id?: string | null;
  station_id?: string | null;
  printer_group_id: string;
  priority: number;
  copies: number;
}

export interface PrintJob {
  id: string;
  branch_id: string;
  document_type: string;
  entity_type: string;
  entity_id: string;
  printer_id?: string;
  printer_group_id?: string;
  /** The station a kitchen chit is for, e.g. "Grill (1/3)" when the order was split. */
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

export interface KitchenTicketItem {
  id: string;
  ticket_id: string;
  order_item_id: string;
  product_name: string;
  quantity: string;
  state: 'NEW' | 'IN_PROGRESS' | 'READY' | 'CANCELLED';
  status: 'PENDING' | 'COOKING' | 'DONE';
  special_instructions?: string;
  options_summary?: string;
}

export interface KitchenTicket {
  id: string;
  order_id: string;
  order_number: string;
  call_number?: number | null;
  order_type: string;
  table_number?: string;
  customer_name?: string;
  station_id: string;
  station_name?: string;
  target_minutes?: number;
  ticket_number: string;
  state: 'NEW' | 'IN_PROGRESS' | 'READY' | 'BUMPED' | 'RECALLED' | 'CANCELLED';
  status: 'NEW' | 'IN_PREPARATION' | 'READY' | 'BUMPED' | 'RECALLED';
  priority: number;
  is_aggregator: boolean;
  prep_time_seconds: number;
  items: KitchenTicketItem[];
  created_at: string;
}

export const kdsApi = {
  // 1. Stations
  getStations: async (branchId?: string): Promise<KitchenStation[]> => {
    const res = await httpClient.get('/api/v1/kds/stations', { params: { branchId } });
    return res.data;
  },
  createStation: async (data: Partial<KitchenStation>): Promise<KitchenStation> => {
    const res = await httpClient.post('/api/v1/kds/stations', data);
    return res.data;
  },
  updateStation: async (id: string, data: Partial<KitchenStation>): Promise<KitchenStation> => {
    const res = await httpClient.patch(`/api/v1/kds/stations/${id}`, data);
    return res.data;
  },
  deleteStation: async (id: string): Promise<any> => {
    const res = await httpClient.delete(`/api/v1/kds/stations/${id}`);
    return res.data;
  },

  // 2. Screens
  getScreens: async (branchId?: string): Promise<KdsScreen[]> => {
    const res = await httpClient.get('/api/v1/kds/screens', { params: { branchId } });
    return res.data;
  },
  createScreen: async (data: Partial<KdsScreen>): Promise<KdsScreen> => {
    const res = await httpClient.post('/api/v1/kds/screens', data);
    return res.data;
  },
  deleteScreen: async (id: string): Promise<any> => {
    const res = await httpClient.delete(`/api/v1/kds/screens/${id}`);
    return res.data;
  },

  // 3. Routing Rules
  getRoutingRules: async (branchId?: string): Promise<KdsRoutingRule[]> => {
    const res = await httpClient.get('/api/v1/kds/routing-rules', { params: { branchId } });
    return res.data;
  },
  createRoutingRule: async (data: Partial<KdsRoutingRule>): Promise<KdsRoutingRule> => {
    const res = await httpClient.post('/api/v1/kds/routing-rules', data);
    return res.data;
  },
  deleteRoutingRule: async (id: string): Promise<any> => {
    const res = await httpClient.delete(`/api/v1/kds/routing-rules/${id}`);
    return res.data;
  },

  // 4. KDS Tickets & Board
  getKdsBoard: async (branchId: string, stationIds?: string[], state?: string): Promise<KitchenTicket[]> => {
    const res = await httpClient.get('/api/v1/kds/board', {
      params: { branchId, stationIds: stationIds ? stationIds.join(',') : undefined, state },
    });
    return res.data;
  },
  getKdsTickets: async (stationId?: string, isBumped?: boolean, branchId?: string): Promise<KitchenTicket[]> => {
    const res = await httpClient.get('/api/v1/kds/tickets', { params: { stationId, isBumped, branchId } });
    return res.data;
  },
  startTicket: async (ticketId: string): Promise<KitchenTicket> => {
    const res = await httpClient.post(`/api/v1/kds/tickets/${ticketId}/start`);
    return res.data;
  },
  bumpTicket: async (ticketId: string): Promise<KitchenTicket> => {
    const res = await httpClient.post(`/api/v1/kds/tickets/${ticketId}/bump`);
    return res.data;
  },
  recallTicket: async (ticketId: string): Promise<KitchenTicket> => {
    const res = await httpClient.post(`/api/v1/kds/tickets/${ticketId}/recall`);
    return res.data;
  },
  setPriority: async (ticketId: string, priority: number): Promise<KitchenTicket> => {
    const res = await httpClient.post(`/api/v1/kds/tickets/${ticketId}/priority`, { priority });
    return res.data;
  },
  updateItemState: async (itemId: string, state: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/kds/ticket-items/${itemId}/state`, { state });
    return res.data;
  },
  updateItemStatus: async (itemId: string, status: 'PENDING' | 'COOKING' | 'DONE'): Promise<any> => {
    const res = await httpClient.post(`/api/v1/kds/tickets/items/${itemId}/status`, { status });
    return res.data;
  },

  // 5. Printers & Print Operations
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
  getPrinterGroups: async (branchId?: string): Promise<PrinterGroup[]> => {
    const res = await httpClient.get('/api/v1/printer-groups', { params: { branchId } });
    return res.data;
  },
  createPrinterGroup: async (data: Partial<PrinterGroup> & { branch_id?: string; members?: PrinterGroupMember[] }): Promise<PrinterGroup> => {
    const res = await httpClient.post('/api/v1/printer-groups', data);
    return res.data;
  },
  updatePrinterGroup: async (id: string, data: Partial<PrinterGroup> & { branch_id?: string; members?: PrinterGroupMember[] }): Promise<PrinterGroup> => {
    const res = await httpClient.patch(`/api/v1/printer-groups/${id}`, data);
    return res.data;
  },
  deletePrinterGroup: async (id: string): Promise<any> => {
    const res = await httpClient.delete(`/api/v1/printer-groups/${id}`);
    return res.data;
  },
  getPrintRoutes: async (branchId?: string): Promise<PrintRoute[]> => {
    const res = await httpClient.get('/api/v1/print-routes', { params: { branchId } });
    return res.data;
  },
  createPrintRoute: async (data: Partial<PrintRoute>): Promise<PrintRoute> => {
    const res = await httpClient.post('/api/v1/print-routes', data);
    return res.data;
  },
  updatePrintRoute: async (id: string, data: Partial<PrintRoute>): Promise<PrintRoute> => {
    const res = await httpClient.patch(`/api/v1/print-routes/${id}`, data);
    return res.data;
  },
  deletePrintRoute: async (id: string): Promise<any> => {
    const res = await httpClient.delete(`/api/v1/print-routes/${id}`);
    return res.data;
  },

  // 6. Print Jobs & Simulator Outcome
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
  simulatePrintOutcome: async (data: { printJobId: string; scenarioId?: string; outcome: 'SUCCESS' | 'FAILED'; useFallback?: boolean }): Promise<any> => {
    const res = await httpClient.post('/api/v1/simulation/printers/outcome', data);
    return res.data;
  },
  retryPrintJob: async (id: string, data?: { scenarioId?: string; useFallback?: boolean }): Promise<any> => {
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
    /** One station's chit only, by its printer group. */
    printerGroupId?: string
  ): Promise<any> => {
    const res = await httpClient.post(`/api/v1/orders/${orderId}/reprint`, {
      documentType,
      reason,
      printerId,
      printerGroupId,
    });
    return res.data;
  },
};
