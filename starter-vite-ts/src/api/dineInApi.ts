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
  active_session_id?: string;
}

export const dineInApi = {
  getAreas: async (branchId?: string): Promise<DiningArea[]> => {
    const res = await httpClient.get('/api/v1/dine-in/areas', { params: { branchId } });
    return res.data;
  },
  createArea: async (data: Partial<DiningArea>): Promise<DiningArea> => {
    const res = await httpClient.post('/api/v1/dine-in/areas', data);
    return res.data;
  },
  getTables: async (areaId?: string): Promise<DiningTable[]> => {
    const res = await httpClient.get('/api/v1/dine-in/tables', { params: { areaId } });
    return res.data;
  },
  createTable: async (data: Partial<DiningTable>): Promise<DiningTable> => {
    const res = await httpClient.post('/api/v1/dine-in/tables', data);
    return res.data;
  },
  getFloorPlan: async (branchId?: string): Promise<{ areas: DiningArea[]; tables: DiningTable[] }> => {
    const res = await httpClient.get('/api/v1/dine-in/floor-plan', { params: { branchId } });
    return res.data;
  },
  seatGuests: async (tableId: string, guestCount: number, orderId?: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/dine-in/tables/${tableId}/seat`, { guestCount, orderId });
    return res.data;
  },
  transferTable: async (sourceTableId: string, targetTableId: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/dine-in/tables/${sourceTableId}/transfer`, { targetTableId });
    return res.data;
  },
  mergeTables: async (sourceTableId: string, targetTableId: string): Promise<any> => {
    const res = await httpClient.post('/api/v1/dine-in/tables/merge', { sourceTableId, targetTableId });
    return res.data;
  },
  releaseTable: async (tableId: string, nextStatus?: 'AVAILABLE' | 'CLEANING'): Promise<any> => {
    const res = await httpClient.post(`/api/v1/dine-in/tables/${tableId}/release`, { nextStatus });
    return res.data;
  },
};
