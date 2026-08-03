import { httpClient } from './httpClient';

export interface Category {
  id: string;
  code: string;
  name: string;
  parent_id?: string;
  sort_order: number;
  is_active: boolean;
  image_asset_id?: string;
}

export interface Product {
  id: string;
  code: string;
  sku?: string;
  barcode?: string;
  name: string;
  description?: string;
  category_id: string;
  unit_of_measure: string;
  tax_rate: string;
  image_asset_id?: string;
  is_active: boolean;
  base_price: string;
  optionGroups?: OptionGroup[];
}

export interface OptionItem {
  id: string;
  option_group_id: string;
  code: string;
  name: string;
  price_delta: string;
  is_default: boolean;
  sort_order: number;
}

export interface OptionGroup {
  id: string;
  code: string;
  name: string;
  min_selection: number;
  max_selection: number;
  is_required: boolean;
  items?: OptionItem[];
}

export interface PriceGroup {
  id: string;
  code: string;
  name: string;
  currency_code: string;
  is_active: boolean;
}

export const catalogApi = {
  getCategories: async (): Promise<Category[]> => {
    const res = await httpClient.get('/api/v1/categories');
    return res.data;
  },
  createCategory: async (data: Partial<Category>): Promise<Category> => {
    const res = await httpClient.post('/api/v1/categories', data);
    return res.data;
  },
  updateCategory: async (id: string, data: Partial<Category>): Promise<Category> => {
    const res = await httpClient.patch(`/api/v1/categories/${id}`, data);
    return res.data;
  },
  archiveCategory: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/categories/${id}`);
  },

  getProducts: async (categoryId?: string): Promise<Product[]> => {
    const res = await httpClient.get('/api/v1/products', { params: { categoryId } });
    return res.data;
  },
  getProductById: async (id: string): Promise<Product> => {
    const res = await httpClient.get(`/api/v1/products/${id}`);
    return res.data;
  },
  createProduct: async (data: Partial<Product>): Promise<Product> => {
    const res = await httpClient.post('/api/v1/products', data);
    return res.data;
  },
  updateProduct: async (id: string, data: Partial<Product>): Promise<Product> => {
    const res = await httpClient.patch(`/api/v1/products/${id}`, data);
    return res.data;
  },
  archiveProduct: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/products/${id}`);
  },
  attachOptionGroup: async (id: string, optionGroupId: string, sortOrder: number = 0): Promise<any> => {
    const res = await httpClient.post(`/api/v1/products/${id}/option-groups`, { optionGroupId, sortOrder });
    return res.data;
  },

  getOptionGroups: async (): Promise<OptionGroup[]> => {
    const res = await httpClient.get('/api/v1/option-groups');
    return res.data;
  },
  createOptionGroup: async (data: Partial<OptionGroup>): Promise<OptionGroup> => {
    const res = await httpClient.post('/api/v1/option-groups', data);
    return res.data;
  },
  createOptionItem: async (groupId: string, data: Partial<OptionItem>): Promise<OptionItem> => {
    const res = await httpClient.post(`/api/v1/option-groups/${groupId}/items`, data);
    return res.data;
  },

  getPriceGroups: async (): Promise<PriceGroup[]> => {
    const res = await httpClient.get('/api/v1/price-groups');
    return res.data;
  },
  createPriceGroup: async (data: Partial<PriceGroup>): Promise<PriceGroup> => {
    const res = await httpClient.post('/api/v1/price-groups', data);
    return res.data;
  },
  setPriceOverride: async (priceGroupId: string, productId: string, overridePrice: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/price-groups/${priceGroupId}/overrides`, { productId, overridePrice });
    return res.data;
  },
};
