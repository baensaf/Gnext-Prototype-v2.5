import { httpClient } from './httpClient';

export interface DiningArea {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface DiningTable {
  id: string;
  dining_area_id: string;
  code: string;
  table_number: string;
  seating_capacity: number;
  shape: 'RECTANGLE' | 'CIRCLE' | 'SQUARE';
  pos_x: number;
  pos_y: number;
  is_active: boolean;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'BILL_PRINTED' | 'CLEANING';
  guest_count: number;
  elapsed_minutes: number;
  active_order_id?: string;
  order_number?: string;
  grand_total?: string;
  /** Open checks on the table; more than one when a second party or a split shares it. */
  open_check_count?: number;
  active_session_id?: string;
}

export const dineInApi = {
  getSections: async (branchId?: string): Promise<DiningArea[]> => {
    const res = await httpClient.get('/api/v1/dining/sections', { params: { branchId } });
    return res.data;
  },
  createSection: async (data: Partial<DiningArea> & { branchId?: string }): Promise<DiningArea> => {
    const res = await httpClient.post('/api/v1/dining/sections', data);
    return res.data;
  },
  updateSection: async (id: string, data: Partial<DiningArea>): Promise<DiningArea> => {
    const res = await httpClient.patch(`/api/v1/dining/sections/${id}`, data);
    return res.data;
  },
  archiveSection: async (id: string): Promise<DiningArea> => {
    const res = await httpClient.delete(`/api/v1/dining/sections/${id}`);
    return res.data;
  },
  getTables: async (areaId?: string, branchId?: string): Promise<DiningTable[]> => {
    const res = await httpClient.get('/api/v1/dining/tables', { params: { areaId, branchId } });
    return res.data;
  },
  createTable: async (data: Partial<DiningTable>): Promise<DiningTable> => {
    const res = await httpClient.post('/api/v1/dining/tables', data);
    return res.data;
  },
  updateTable: async (id: string, data: Partial<DiningTable>): Promise<DiningTable> => {
    const res = await httpClient.patch(`/api/v1/dining/tables/${id}`, data);
    return res.data;
  },
  archiveTable: async (id: string): Promise<DiningTable> => {
    const res = await httpClient.delete(`/api/v1/dining/tables/${id}`);
    return res.data;
  },
  getFloorPlan: async (branchId?: string, sectionId?: string, status?: string): Promise<{ areas: DiningArea[]; tables: DiningTable[] }> => {
    const res = await httpClient.get('/api/v1/dining/floor', { params: { branchId, sectionId, status } });
    return res.data;
  },
  moveTable: async (orderId: string, targetTableId: string, guestCount?: number): Promise<any> => {
    const res = await httpClient.post(`/api/v1/dining/orders/${orderId}/move-table`, { targetTableId, guestCount });
    return res.data;
  },
  mergeOrders: async (sourceOrderIds: string[], targetOrderId: string, reason?: string): Promise<any> => {
    const res = await httpClient.post('/api/v1/dining/orders/merge', { sourceOrderIds, targetOrderId, reason });
    return res.data;
  },
  seatGuests: async (tableId: string, guestCount: number, orderId?: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/dining/tables/${tableId}/seat`, { guestCount, orderId });
    return res.data;
  },
  releaseTable: async (tableId: string, nextStatus?: 'AVAILABLE' | 'CLEANING'): Promise<any> => {
    const res = await httpClient.post(`/api/v1/dining/tables/${tableId}/release`, { nextStatus });
    return res.data;
  },
  // Legacy aliases
  getAreas: async (branchId?: string): Promise<DiningArea[]> => {
    const res = await httpClient.get('/api/v1/dining/sections', { params: { branchId } });
    return res.data;
  },
  createArea: async (data: Partial<DiningArea>): Promise<DiningArea> => {
    const res = await httpClient.post('/api/v1/dining/sections', data);
    return res.data;
  },
  transferTable: async (sourceTableId: string, targetTableId: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/dining/tables/${sourceTableId}/release`, { nextStatus: 'AVAILABLE' });
    return res.data;
  },
  mergeTables: async (sourceTableId: string, targetTableId: string): Promise<any> => {
    const res = await httpClient.post('/api/v1/dining/tables/release', { sourceTableId, targetTableId });
    return res.data;
  },
};
