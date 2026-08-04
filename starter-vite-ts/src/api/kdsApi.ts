import { httpClient } from './httpClient';

export interface KitchenStation {
  id: string;
  code: string;
  name: string;
  station_type: string;
  is_active: boolean;
}

export interface PrinterDevice {
  id: string;
  code: string;
  name: string;
  ip_address?: string;
  printer_type: string;
  paper_width_mm: number;
  is_active: boolean;
}

export interface KitchenTicketItem {
  id: string;
  ticket_id: string;
  product_name: string;
  quantity: string;
  status: 'PENDING' | 'COOKING' | 'DONE';
  special_instructions?: string;
  options_summary?: string;
}

export interface KitchenTicket {
  id: string;
  order_id: string;
  order_number: string;
  order_type: string;
  table_number?: string;
  station_id: string;
  ticket_number: string;
  status: 'NEW' | 'IN_PREPARATION' | 'READY' | 'BUMPED' | 'RECALLED';
  prep_time_seconds: number;
  items: KitchenTicketItem[];
  created_at: string;
}

export const kdsApi = {
  getStations: async (branchId?: string): Promise<KitchenStation[]> => {
    const res = await httpClient.get('/api/v1/kds/stations', { params: { branchId } });
    return res.data;
  },
  createStation: async (data: Partial<KitchenStation>): Promise<KitchenStation> => {
    const res = await httpClient.post('/api/v1/kds/stations', data);
    return res.data;
  },
  getPrinters: async (branchId?: string): Promise<PrinterDevice[]> => {
    const res = await httpClient.get('/api/v1/kds/printers', { params: { branchId } });
    return res.data;
  },
  createPrinter: async (data: Partial<PrinterDevice>): Promise<PrinterDevice> => {
    const res = await httpClient.post('/api/v1/kds/printers', data);
    return res.data;
  },
  getKdsTickets: async (stationId?: string, isBumped?: boolean): Promise<KitchenTicket[]> => {
    const res = await httpClient.get('/api/v1/kds/tickets', { params: { stationId, isBumped } });
    return res.data;
  },
  bumpTicket: async (ticketId: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/kds/tickets/${ticketId}/bump`);
    return res.data;
  },
  recallTicket: async (ticketId: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/kds/tickets/${ticketId}/recall`);
    return res.data;
  },
  updateItemStatus: async (itemId: string, status: 'PENDING' | 'COOKING' | 'DONE'): Promise<any> => {
    const res = await httpClient.post(`/api/v1/kds/tickets/items/${itemId}/status`, { status });
    return res.data;
  },
  simulatePrint: async (data: { ticket_id?: string; order_id?: string; paper_width_mm?: number }): Promise<any> => {
    const res = await httpClient.post('/api/v1/kds/printers/simulate-print', data);
    return res.data;
  },
};
