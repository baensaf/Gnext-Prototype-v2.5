import { httpClient } from './httpClient';


export interface DeliveryZone {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  /** The outline drawn on the map (GeoJSON Polygon). The till still picks a zone by postal code. */
  polygon?: { type: 'Polygon'; coordinates: number[][][] } | null;
  postal_prefixes?: string[];
  fee: string;
  currency_code: string;
  estimated_minutes: number;
  is_active: boolean;
}

export interface Courier {
  id: string;
  branch_id?: string;
  code: string;
  name: string;
  phone?: string;
  vehicle_type: string;
  currency_code: string;
  status: string;
  is_active: boolean;
  active_delivery_count?: number;
}

export interface Delivery {
  id: string;
  order_id: string;
  order_number: string;
  zone_id?: string;
  zone_name?: string;
  courier_id?: string;
  courier_name?: string;
  courier_phone?: string;
  state: 'UNASSIGNED' | 'ASSIGNED' | 'PICKED_UP' | 'EN_ROUTE' | 'DELIVERED' | 'CANCELLED';
  fee: string;
  currency_code: string;
  grand_total: string;
  /** What the customer still owes on the order; a courier brings it back at settlement. */
  outstanding_total?: string;
  /** Null when the order has no customer on file. */
  customer_name: string | null;
  customer_phone?: string | null;
  /** The number the counter calls the order by. */
  call_number?: number | null;
  /** The order's own state, e.g. whether the kitchen has marked it ready. */
  order_state?: string;
  /** When the order was sent; the card counts its waiting time from here. */
  submitted_at?: string | null;
  zone_estimated_minutes?: number | null;
  address_snapshot?: any;
  assigned_at?: string;
  picked_up_at?: string;
  delivered_at?: string;
  cash_expected: string;
  mobile_pos_expected: string;
  created_at: string;
}

export interface DeliveryEvent {
  id: string;
  delivery_id: string;
  from_state: string;
  to_state: string;
  reason?: string;
  occurred_at: string;
  occurred_by?: string;
}

export const deliveryApi = {
  // Zones
  getZones: async (branchId?: string): Promise<DeliveryZone[]> => {
    const res = await httpClient.get('/api/v1/delivery/zones', { params: { branchId } });
    return res.data;
  },
  createZone: async (data: Partial<DeliveryZone>): Promise<DeliveryZone> => {
    const res = await httpClient.post('/api/v1/delivery/zones', data);
    return res.data;
  },
  updateZone: async (
    id: string,
    data: { name?: string; fee?: string; estimated_minutes?: number; polygon?: DeliveryZone['polygon'] }
  ): Promise<DeliveryZone> => {
    const res = await httpClient.patch(`/api/v1/delivery/zones/${id}`, data);
    return res.data;
  },
  deleteZone: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/delivery/zones/${id}`);
  },

  // Couriers
  getCouriers: async (branchId?: string): Promise<Courier[]> => {
    const res = await httpClient.get('/api/v1/delivery/couriers', { params: { branchId } });
    return res.data;
  },
  createCourier: async (data: Partial<Courier>): Promise<Courier> => {
    const res = await httpClient.post('/api/v1/delivery/couriers', data);
    return res.data;
  },
  updateCourierStatus: async (id: string, status: 'AVAILABLE' | 'ON_DELIVERY' | 'INACTIVE'): Promise<Courier> => {
    const res = await httpClient.post(`/api/v1/delivery/couriers/${id}/status`, { status });
    return res.data;
  },

  // Deliveries & Board
  getDeliveries: async (branchId?: string, state?: string): Promise<Delivery[]> => {
    const res = await httpClient.get('/api/v1/delivery/board', { params: { branchId, state } });
    return res.data;
  },
  createDeliveryForOrder: async (orderId: string, zoneId?: string, addressSnapshot?: any): Promise<Delivery> => {
    const res = await httpClient.post(`/api/v1/delivery/orders/${orderId}`, { zoneId, addressSnapshot });
    return res.data;
  },
  /** Names the courier and sends the order out in one step. */
  dispatchCourier: async (deliveryId: string, courierId: string): Promise<Delivery> => {
    const res = await httpClient.post(`/api/v1/delivery/${deliveryId}/dispatch`, { courierId });
    return res.data;
  },
  departDelivery: async (deliveryId: string): Promise<Delivery> => {
    const res = await httpClient.post(`/api/v1/delivery/${deliveryId}/depart`);
    return res.data;
  },
  completeDelivery: async (deliveryId: string, cashCollected?: string | number, posAmount?: string | number): Promise<Delivery> => {
    const res = await httpClient.post(`/api/v1/delivery/${deliveryId}/complete`, { cashCollected, posAmount });
    return res.data;
  },
  getEvents: async (deliveryId: string): Promise<DeliveryEvent[]> => {
    const res = await httpClient.get(`/api/v1/delivery/${deliveryId}/events`);
    return res.data;
  },

  // Settlements
  getUnsettledSummary: async (branchId?: string): Promise<any[]> => {
    const res = await httpClient.get('/api/v1/courier-settlements/unsettled-summary', { params: { branchId } });
    return res.data;
  },
  previewSettlement: async (courierId: string, lineIds?: string[]): Promise<any> => {
    const res = await httpClient.post('/api/v1/courier-settlements/preview', { courier_id: courierId, lineIds });
    return res.data;
  },
  getSettlements: async (courierId?: string, status?: string, branchId?: string): Promise<any[]> => {
    const res = await httpClient.get('/api/v1/courier-settlements', { params: { courierId, status, branchId } });
    return res.data;
  },
  createSettlement: async (data: { courier_id: string; assignment_ids?: string[]; notes?: string }): Promise<any> => {
    const res = await httpClient.post('/api/v1/courier-settlements', data);
    return res.data;
  },
  getSettlementDetail: async (id: string): Promise<any> => {
    const res = await httpClient.get(`/api/v1/courier-settlements/${id}`);
    return res.data;
  },
  updateSettlement: async (id: string, data: any): Promise<any> => {
    const res = await httpClient.patch(`/api/v1/courier-settlements/${id}`, data);
    return res.data;
  },
  closeSettlement: async (id: string, approvalRequestId?: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/courier-settlements/${id}/close`, { approvalRequestId });
    return res.data;
  },
  reverseSettlement: async (id: string, reason?: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/courier-settlements/${id}/reverse`, { reason });
    return res.data;
  },
  getSettlementStatement: async (id: string): Promise<any> => {
    const res = await httpClient.get(`/api/v1/courier-settlements/${id}/statement`);
    return res.data;
  },

  // Legacy fallback
  getAssignments: async (branchId?: string, status?: string): Promise<any[]> => {
    const res = await httpClient.get('/api/v1/delivery/assignments', { params: { branchId, status } });
    return res.data;
  },
  assignOrder: async (orderId: string, courierId: string, deliveryFee?: number, tipAmount?: number): Promise<any> => {
    const res = await httpClient.post(`/api/v1/delivery/orders/${orderId}/assign`, { courierId, deliveryFee, tipAmount });
    return res.data;
  },
  updateAssignmentStatus: async (assignmentId: string, status: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/delivery/assignments/${assignmentId}/status`, { status });
    return res.data;
  },
};
