import { httpClient } from './httpClient';

export interface Courier {
  id: string;
  code: string;
  name: string;
  phone?: string;
  vehicle_type: 'MOTORCYCLE' | 'BICYCLE' | 'CAR' | 'ON_FOOT';
  status: 'AVAILABLE' | 'ON_DELIVERY' | 'INACTIVE';
  is_active: boolean;
}

export interface DeliveryAssignment {
  id: string;
  order_id: string;
  courier_id: string;
  courier_name: string;
  courier_phone: string;
  courier_vehicle: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  order_total: string;
  status: 'ASSIGNED' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURNED';
  assigned_at: string;
  picked_up_at?: string;
  delivered_at?: string;
  delivery_fee: string;
  tip_amount: string;
  failure_reason?: string;
}

export const deliveryApi = {
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
  getAssignments: async (branchId?: string, status?: string): Promise<DeliveryAssignment[]> => {
    const res = await httpClient.get('/api/v1/delivery/assignments', { params: { branchId, status } });
    return res.data;
  },
  assignOrder: async (orderId: string, courierId: string, deliveryFee?: number, tipAmount?: number): Promise<DeliveryAssignment> => {
    const res = await httpClient.post(`/api/v1/delivery/orders/${orderId}/assign`, { courierId, deliveryFee, tipAmount });
    return res.data;
  },
  updateAssignmentStatus: async (
    assignmentId: string,
    status: 'ASSIGNED' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURNED',
    failureReason?: string,
  ): Promise<DeliveryAssignment> => {
    const res = await httpClient.post(`/api/v1/delivery/assignments/${assignmentId}/status`, { status, failureReason });
    return res.data;
  },
};
