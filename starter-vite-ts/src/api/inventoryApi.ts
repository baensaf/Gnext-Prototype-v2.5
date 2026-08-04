import { httpClient } from './httpClient';

export interface InventoryItem {
  id: string;
  tenant_id: string;
  product_id: string;
  branch_id: string;
  quantity_on_hand: string;
  reorder_level: string;
  unit_of_measure: string;
  last_counted_at?: string;
  product_name: string;
  product_code: string;
  is_low_stock: boolean;
}

export interface InventoryTransaction {
  id: string;
  tenant_id: string;
  inventory_item_id: string;
  transaction_type: string;
  quantity_delta: string;
  reason_code_id?: string;
  note?: string;
  recorded_at: string;
}

export const inventoryApi = {
  getInventoryItems: async (branchId?: string): Promise<InventoryItem[]> => {
    const res = await httpClient.get('/api/v1/inventory/items', { params: { branchId } });
    return res.data;
  },
  getLowStockAlerts: async (branchId?: string): Promise<InventoryItem[]> => {
    const res = await httpClient.get('/api/v1/inventory/alerts', { params: { branchId } });
    return res.data;
  },
  postTransaction: async (data: {
    inventory_item_id: string;
    transaction_type: string;
    quantity_delta: string;
    reason_code_id?: string;
    note?: string;
  }): Promise<{ transaction: InventoryTransaction; item: InventoryItem }> => {
    const res = await httpClient.post('/api/v1/inventory/transactions', data);
    return res.data;
  },
  getItemTransactions: async (inventoryItemId: string): Promise<InventoryTransaction[]> => {
    const res = await httpClient.get(`/api/v1/inventory/items/${inventoryItemId}/transactions`);
    return res.data;
  },
};
