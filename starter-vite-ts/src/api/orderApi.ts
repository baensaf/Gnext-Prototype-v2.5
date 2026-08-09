import { httpClient } from './httpClient';

export interface OrderItemOption {
  id: string;
  option_item_id: string;
  option_group_name: string;
  option_item_name: string;
  price_delta: string;
}

export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  unit_price: string;
  quantity: string;
  subtotal: string;
  tax_amount: string;
  discount_amount: string;
  total_amount: string;
  special_instructions?: string;
  options: OrderItemOption[];
}

export interface OrderHeader {
  id: string;
  branch_id: string;
  terminal_id?: string;
  order_number: string;
  order_type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'AGGREGATOR';
  status: 'DRAFT' | 'SUBMITTED' | 'KITCHEN_PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
  customer_id?: string;
  customer_name?: string;
  customer_mobile?: string;
  coupon_code?: string;
  subtotal_amount: string;
  tax_amount: string;
  discount_amount: string;
  total_amount: string;
  paid_amount: string;
  due_amount: string;
  table_number?: string;
  notes?: string;
  placed_at: string;
  items: OrderItem[];
}

export const orderApi = {
  getOrders: async (branchId?: string, status?: string): Promise<OrderHeader[]> => {
    const res = await httpClient.get('/api/v1/orders', { params: { branchId, status } });
    return res.data;
  },
  getOrderById: async (id: string): Promise<OrderHeader> => {
    const res = await httpClient.get(`/api/v1/orders/${id}`);
    return res.data;
  },
  createOrder: async (data: {
    branch_id: string;
    terminal_id?: string;
    order_type?: string;
    customer_id?: string;
    coupon_code?: string;
    table_number?: string;
    notes?: string;
    items: Array<{
      product_id: string;
      quantity: number | string;
      special_instructions?: string;
      options?: Array<{ option_item_id: string }>;
    }>;
  }): Promise<OrderHeader> => {
    const res = await httpClient.post('/api/v1/orders', data);
    return res.data;
  },
  updateOrderStatus: async (
    id: string,
    status: string,
    cancellation_reason_code_id?: string,
  ): Promise<OrderHeader> => {
    const res = await httpClient.patch(`/api/v1/orders/${id}/status`, {
      status,
      cancellation_reason_code_id,
    });
    return res.data;
  },
};
