import { httpClient } from './httpClient';

export interface DeliveryZone {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  polygon?: any;
  postal_prefixes?: string[];
  fee: string;
  currency_code: string;
  estimated_minutes: number;
  is_active: boolean;
}

export interface CourierAttendance {
  id?: string;
  status: 'CHECKED_IN' | 'CHECKED_OUT' | 'PAUSED';
  availability_status: 'AVAILABLE' | 'BUSY' | 'OFF_LINE';
  checked_in_at?: string;
  checked_out_at?: string;
}

export interface CourierTerminalAssignment {
  id?: string;
  terminal_id: string;
  terminal_name?: string;
  assigned_at: string;
  is_active: boolean;
}

export interface Courier {
  id: string;
  branch_id?: string;
  code: string;
  name: string;
  phone?: string;
  vehicle_type: string;
  compensation_per_delivery: string;
  currency_code: string;
  status: string;
  is_active: boolean;
  attendance?: CourierAttendance;
  active_terminal?: CourierTerminalAssignment | null;
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
  state: 'UNASSIGNED' | 'ASSIGNED' | 'PICKED_UP' | 'EN_ROUTE' | 'DELIVERED' | 'FAILED' | 'CANCELLED';
  fee: string;
  currency_code: string;
  grand_total: string;
  customer_name: string;
  address_snapshot?: any;
  assigned_at?: string;
  picked_up_at?: string;
  delivered_at?: string;
  cash_expected: string;
  mobile_pos_expected: string;
  compensation_amount: string;
  failure_reason?: string;
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
  deleteZone: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/delivery/zones/${id}`);
  },

  // Couriers & Attendance
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
  recordAttendance: async (data: { courier_id: string; branch_id: string; status: 'CHECKED_IN' | 'CHECKED_OUT' | 'PAUSED'; availability_status?: 'AVAILABLE' | 'BUSY' | 'OFF_LINE' }): Promise<CourierAttendance> => {
    const res = await httpClient.post('/api/v1/delivery/couriers/attendance', data);
    return res.data;
  },
  setAvailability: async (courierId: string, availability_status: 'AVAILABLE' | 'BUSY' | 'OFF_LINE'): Promise<CourierAttendance> => {
    const res = await httpClient.post(`/api/v1/delivery/couriers/${courierId}/availability`, { availability_status });
    return res.data;
  },

  // Terminal Assignments
  assignTerminal: async (courierId: string, terminalId: string): Promise<CourierTerminalAssignment> => {
    const res = await httpClient.post(`/api/v1/delivery/couriers/${courierId}/terminal-assignment`, { terminalId });
    return res.data;
  },
  unassignTerminal: async (courierId: string): Promise<void> => {
    await httpClient.delete(`/api/v1/delivery/couriers/${courierId}/terminal-assignment`);
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
  assignCourier: async (deliveryId: string, courierId: string): Promise<Delivery> => {
    const res = await httpClient.post(`/api/v1/delivery/${deliveryId}/assign`, { courierId });
    return res.data;
  },
  departDelivery: async (deliveryId: string): Promise<Delivery> => {
    const res = await httpClient.post(`/api/v1/delivery/${deliveryId}/depart`);
    return res.data;
  },
  completeDelivery: async (deliveryId: string, cashCollected?: number, posAmount?: number): Promise<Delivery> => {
    const res = await httpClient.post(`/api/v1/delivery/${deliveryId}/complete`, { cashCollected, posAmount });
    return res.data;
  },
  failDelivery: async (deliveryId: string, reason: string): Promise<Delivery> => {
    const res = await httpClient.post(`/api/v1/delivery/${deliveryId}/fail`, { reason });
    return res.data;
  },
  requeueDelivery: async (deliveryId: string): Promise<Delivery> => {
    const res = await httpClient.post(`/api/v1/delivery/${deliveryId}/requeue`);
    return res.data;
  },
  getEvents: async (deliveryId: string): Promise<DeliveryEvent[]> => {
    const res = await httpClient.get(`/api/v1/delivery/${deliveryId}/events`);
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
  updateAssignmentStatus: async (assignmentId: string, status: string, failureReason?: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/delivery/assignments/${assignmentId}/status`, { status, failureReason });
    return res.data;
  },
};
