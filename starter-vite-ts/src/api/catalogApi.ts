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

export interface ProductVariant {
  id: string;
  tenant_id?: string;
  product_id: string;
  code: string;
  name: string;
  sku?: string;
  barcode?: string;
  base_price: string;
  is_default: boolean;
  sort_order: number;
  is_active: boolean;
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
  /** COMBO: a meal deal sold as one line; its option groups are slots that must be filled. */
  product_type?: 'STANDARD' | 'COMBO';
  optionGroups?: OptionGroup[];
  variants?: ProductVariant[];
}

export interface OptionItem {
  id: string;
  option_group_id: string;
  code: string;
  name: string;
  price_delta: string;
  /** The dish this choice gives, for a combo slot. */
  product_id?: string | null;
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

export interface MenuCategory {
  id: string;
  menu_id: string;
  category_id: string;
  sort_order: number;
}

export interface MenuProduct {
  id: string;
  menu_id: string;
  product_id: string;
  category_id?: string;
  sort_order: number;
  override_price?: string;
}

export interface Menu {
  id: string;
  code: string;
  name: string;
  branch_id?: string;
  channel: string;
  is_active: boolean;
  valid_from?: string;
  valid_to?: string;
  categories?: MenuCategory[];
  products?: MenuProduct[];
}

export interface ProductAvailability {
  id: string;
  product_id: string;
  branch_id?: string;
  channel?: string;
  is_suspended: boolean;
  suspended_until?: string;
  reason?: string;
}

/** A weekly selling window for a product or a category. Days: 0 = Sunday … 6 = Saturday. */
export interface AvailabilitySchedule {
  id: string;
  product_id: string | null;
  category_id: string | null;
  branch_id: string | null;
  days_of_week: string;
  start_time: string;
  end_time: string;
  label: string | null;
  is_active: boolean;
}

export interface OffScheduleProduct {
  product_id: string;
  windows: string;
}

export interface PriceDiagnostic {
  product_id: string;
  base_price: string;
  effective_price: string;
  resolution_source: 'MENU_OVERRIDE' | 'PRICE_GROUP' | 'BASE_PRICE';
  is_overridden: boolean;
  price_group_id?: string;
  branch_id?: string;
  channel?: string;
  is_suspended: boolean;
  suspension_reason?: string;
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

  // Product Variants
  getProductVariants: async (productId: string): Promise<ProductVariant[]> => {
    const res = await httpClient.get(`/api/v1/products/${productId}/variants`);
    return res.data;
  },
  createProductVariant: async (productId: string, data: Partial<ProductVariant>): Promise<ProductVariant> => {
    const res = await httpClient.post(`/api/v1/products/${productId}/variants`, data);
    return res.data;
  },
  updateProductVariant: async (productId: string, variantId: string, data: Partial<ProductVariant>): Promise<ProductVariant> => {
    const res = await httpClient.patch(`/api/v1/products/${productId}/variants/${variantId}`, data);
    return res.data;
  },
  deleteProductVariant: async (productId: string, variantId: string): Promise<void> => {
    await httpClient.delete(`/api/v1/products/${productId}/variants/${variantId}`);
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

  bulkUpdatePrices: async (data: { price_group_id?: string; category_id?: string; adjustment_type: 'PERCENTAGE' | 'FIXED'; amount: string }): Promise<any> => {
    const res = await httpClient.post('/api/v1/catalog/prices/bulk-update', data);
    return res.data;
  },

  // Menus
  getMenus: async (branchId?: string, channel?: string): Promise<Menu[]> => {
    const res = await httpClient.get('/api/v1/menus', { params: { branchId, channel } });
    return res.data;
  },
  getMenuById: async (id: string): Promise<Menu> => {
    const res = await httpClient.get(`/api/v1/menus/${id}`);
    return res.data;
  },
  createMenu: async (data: Partial<Menu>): Promise<Menu> => {
    const res = await httpClient.post('/api/v1/menus', data);
    return res.data;
  },
  updateMenu: async (id: string, data: Partial<Menu>): Promise<Menu> => {
    const res = await httpClient.patch(`/api/v1/menus/${id}`, data);
    return res.data;
  },
  deleteMenu: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/menus/${id}`);
  },
  addCategoryToMenu: async (id: string, categoryId: string, sortOrder: number = 0): Promise<any> => {
    const res = await httpClient.post(`/api/v1/menus/${id}/categories`, { categoryId, sortOrder });
    return res.data;
  },
  addProductToMenu: async (id: string, productId: string, categoryId?: string, sortOrder: number = 0, overridePrice?: string): Promise<any> => {
    const res = await httpClient.post(`/api/v1/menus/${id}/products`, { productId, categoryId, sortOrder, overridePrice });
    return res.data;
  },

  // Availability & Suspension
  getAvailabilities: async (branchId?: string): Promise<ProductAvailability[]> => {
    const res = await httpClient.get('/api/v1/availability', { params: { branchId } });
    return res.data;
  },
  suspendProduct: async (productId: string, branchId?: string, hours: number = 2, reason?: string): Promise<any> => {
    const res = await httpClient.post('/api/v1/availability/suspend', { productId, branchId, hours, reason });
    return res.data;
  },
  resumeProduct: async (productId: string, branchId?: string): Promise<any> => {
    const res = await httpClient.post('/api/v1/availability/resume', { productId, branchId });
    return res.data;
  },
  getSchedules: async (branchId?: string): Promise<AvailabilitySchedule[]> => {
    const res = await httpClient.get('/api/v1/availability/schedules', { params: { branchId } });
    return res.data;
  },
  getOffScheduleProducts: async (branchId?: string): Promise<OffScheduleProduct[]> => {
    const res = await httpClient.get('/api/v1/availability/off-schedule', { params: { branchId } });
    return res.data;
  },
  createSchedule: async (data: {
    productId?: string;
    categoryId?: string;
    branchId?: string;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    label?: string;
  }): Promise<AvailabilitySchedule> => {
    const res = await httpClient.post('/api/v1/availability/schedules', data);
    return res.data;
  },
  deleteSchedule: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/availability/schedules/${id}`);
  },

  // Price Diagnostics
  getEffectivePriceDiagnostic: async (productId: string, priceGroupId?: string, branchId?: string, channel?: string): Promise<PriceDiagnostic> => {
    const res = await httpClient.get(`/api/v1/products/${productId}/effective-price`, { params: { priceGroupId, branchId, channel } });
    return res.data;
  },
};
