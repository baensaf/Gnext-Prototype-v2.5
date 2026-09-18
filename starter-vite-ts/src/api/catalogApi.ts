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
  /** Packaging per unit, as Snappfood's containerPrice. Stored for the channel, not billed here. */
  container_price?: string;
  /** Most units one order may hold; null for no cap. */
  max_per_order?: number | null;
  /** Photos after the main one, in order. */
  gallery_asset_ids?: string[];
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
  /** On a product's own groups: the items this product leaves out. */
  excluded_item_ids?: string[];
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
  /** Null on an add-on stop. */
  product_id: string | null;
  /** Set when only this variant is off. */
  variant_id?: string | null;
  /** Set when the stop is on an add-on item. */
  option_item_id?: string | null;
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

/** Today's count for an item at a branch, with what live orders already hold. */
export interface DailyStockLine {
  id: string;
  product_id: string;
  variant_id: string | null;
  business_date: string;
  quantity: number;
  sold: number;
  remaining: number;
}

/** What a stop is on and how long it lasts. */
export interface StopRequest {
  productId?: string;
  variantId?: string;
  optionItemId?: string;
  branchId?: string;
  /** NEXT_SHIFT: back when the branch next opens. MANUAL: until someone puts it back. */
  until: 'NEXT_SHIFT' | 'MANUAL' | 'HOURS';
  hours?: number;
  reason?: string;
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

export interface ChannelPriceSheet {
  channel: string;
  rule: { markup_percent: number; round_to: number };
  items: Array<{
    product_id: string;
    variant_id: string | null;
    category_id: string;
    name: string;
    base_price: string;
    rule_price: string;
    fixed_price: string | null;
    price: string;
  }>;
  add_ons: Array<{ option_item_id: string; name: string; base_price: string; price: string }>;
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
  updateOptionGroup: async (id: string, data: Partial<OptionGroup>): Promise<OptionGroup> => {
    const res = await httpClient.patch(`/api/v1/option-groups/${id}`, data);
    return res.data;
  },
  deleteOptionGroup: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/option-groups/${id}`);
  },
  updateOptionItem: async (groupId: string, itemId: string, data: Partial<OptionItem>): Promise<OptionItem> => {
    const res = await httpClient.patch(`/api/v1/option-groups/${groupId}/items/${itemId}`, data);
    return res.data;
  },
  deleteOptionItem: async (groupId: string, itemId: string): Promise<void> => {
    await httpClient.delete(`/api/v1/option-groups/${groupId}/items/${itemId}`);
  },
  detachOptionGroup: async (productId: string, groupId: string): Promise<void> => {
    await httpClient.delete(`/api/v1/products/${productId}/option-groups/${groupId}`);
  },
  setExcludedOptionItems: async (productId: string, groupId: string, excludedItemIds: string[]): Promise<any> => {
    const res = await httpClient.put(`/api/v1/products/${productId}/option-groups/${groupId}/excluded-items`, {
      excludedItemIds,
    });
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

  // Aggregator price sheet (Snappfood): the markup rule applied to every item, plus fixed prices.
  getChannelPriceSheet: async (channel: string): Promise<ChannelPriceSheet> => {
    const res = await httpClient.get('/api/v1/catalog/channel-prices', { params: { channel } });
    return res.data;
  },
  setChannelFixedPrice: async (channel: string, productId: string, variantId: string | null, amount: string | null): Promise<ChannelPriceSheet> => {
    const res = await httpClient.put('/api/v1/catalog/channel-prices', { channel, productId, variantId, amount });
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
  /** Take a product, one variant or an add-on off sale, Snappfood-style. */
  stopItem: async ({ until, hours, ...target }: StopRequest): Promise<ProductAvailability> => {
    const res = await httpClient.post('/api/v1/availability/suspend', {
      ...target,
      until: until === 'NEXT_SHIFT' ? 'NEXT_SHIFT' : undefined,
      hours: until === 'HOURS' ? hours : 0,
    });
    return res.data;
  },
  resumeItem: async (target: {
    productId?: string;
    variantId?: string;
    optionItemId?: string;
    branchId?: string;
  }): Promise<any> => {
    const res = await httpClient.post('/api/v1/availability/resume', target);
    return res.data;
  },
  getNextShift: async (branchId?: string): Promise<{ next_shift_start: string }> => {
    const res = await httpClient.get('/api/v1/availability/next-shift', { params: { branchId } });
    return res.data;
  },
  getDailyStock: async (branchId?: string): Promise<DailyStockLine[]> => {
    const res = await httpClient.get('/api/v1/availability/daily-stock', { params: { branchId } });
    return res.data;
  },
  setDailyStock: async (
    entries: Array<{ productId: string; variantId?: string | null; quantity: number | null }>,
    branchId?: string
  ): Promise<DailyStockLine[]> => {
    const res = await httpClient.put('/api/v1/availability/daily-stock', { branchId, entries });
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
