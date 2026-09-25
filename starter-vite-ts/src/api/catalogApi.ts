import { httpClient } from './httpClient';

/** ITEM sits on one line of an order, ORDER on the whole ticket. */
export type NoteTemplateScope = 'ITEM' | 'ORDER';

/** A phrase the till drops into a note with one tap. */
export interface NoteTemplate {
  id: string;
  scope: NoteTemplateScope;
  text: string;
  category?: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface Category {
  id: string;
  code: string;
  name: string;
  /** A sub-category's parent; categories nest one level. */
  parent_id?: string | null;
  sort_order: number;
  is_active: boolean;
  image_asset_id?: string;
  /** How many products are in it; on the full list only. */
  product_count?: number;
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
  /** The main photo; null once every photo is removed. */
  image_asset_id?: string | null;
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
  /** The main photo's address; on the product list only. */
  image_url?: string | null;
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

/** A branch price list. Branches on it sell at its prices, everything else at base. */
export interface PriceList {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  branch_ids: string[];
  /** How many items the list prices itself. */
  price_count: number;
}

export interface PriceListSheet {
  price_list: { id: string; name: string; is_active: boolean };
  items: Array<{
    product_id: string;
    variant_id: string | null;
    category_id: string;
    name: string;
    base_price: string;
    list_price: string | null;
    price: string;
  }>;
}

/** What each item costs in store at one branch: one row per product and one per size. */
export interface BranchPrices {
  branch_id: string | null;
  price_list: { id: string; name: string } | null;
  items: Array<{ product_id: string; variant_id: string | null; price: string }>;
}

/** A dated price change: base prices or one list, by a percentage or an amount, from a day. */
export interface PriceChangeInput {
  /** Menu items (default) or add-ons; add-on prices are chain-wide, so no list or category. */
  target?: 'ITEMS' | 'ADDONS';
  /** With add-ons: one add-on group, or empty for all. */
  option_group_id?: string | null;
  price_list_id?: string | null;
  category_id?: string | null;
  adjustment: 'PERCENT' | 'AMOUNT';
  value: string;
  round_to?: number | null;
  /** YYYY-MM-DD business day; empty for now. */
  effective_date?: string | null;
}

export interface PriceChangePreview {
  effective_from: string;
  price_list: { id: string; name: string } | null;
  items: Array<{ product_id: string | null; variant_id: string | null; option_item_id: string | null; name: string; current: string; new: string }>;
  changed: number;
}

export interface PriceChange {
  id: string;
  status: 'SCHEDULED' | 'APPLIED' | 'CANCELLED';
  price_list: { id: string; name: string | null } | null;
  effective_from: string;
  items: number;
  adjustment: 'PERCENT' | 'AMOUNT';
  value: string;
  round_to: number;
  category_id: string | null;
  target: 'ITEMS' | 'ADDONS';
  option_group_id: string | null;
  created_at: string;
  cancelled_at: string | null;
  can_cancel: boolean;
}

export interface PriceHistoryRow {
  at: string;
  until: string | null;
  /** CHANGE: a dated price change; LIST_PRICE: set on a price list; EDIT: typed on the product page. */
  kind: 'CHANGE' | 'LIST_PRICE' | 'BASE' | 'EDIT';
  price_list: string | null;
  size: string | null;
  from: string | null;
  to: string;
  status: 'UPCOMING' | 'CURRENT' | 'ENDED' | null;
}

/** A stop on many items or branches: a category (with sub-categories) or products; branches empty = chain-wide (head office). */
export interface BulkStopRequest {
  categoryId?: string;
  productIds?: string[];
  branchIds?: string[];
  channel?: string;
}

export interface StopReport {
  from: string;
  to: string;
  branch_id: string | null;
  items: Array<{
    name: string;
    kind: 'PRODUCT' | 'SIZE' | 'ADDON';
    stops: number;
    hours: number;
    refused: number;
    refused_quantity: number;
    estimated_lost: string;
  }>;
  totals: { stops: number; hours: number; refused: number; estimated_lost: string };
  stops: Array<{
    item: string;
    branch: string | null;
    chain_wide: boolean;
    channel: string | null;
    reason: string | null;
    source: string;
    by: string | null;
    approver: string | null;
    from: string;
    to: string | null;
    planned_until: string | null;
    ended: 'RESUMED' | 'EXPIRED' | 'CHANGED' | 'ONGOING';
    resumed_by: string | null;
    hours: number;
  }>;
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
  /** Off on this channel only (SNAPPFOOD); empty for everywhere. */
  channel?: string;
}

export interface OffScheduleProduct {
  product_id: string;
  windows: string;
}

export interface ChannelPriceSheet {
  channel: string;
  rule: { markup_percent: number; round_to: number };
  branch_id: string | null;
  /** The list the branch's in-store prices come from, when it is on one. */
  price_list: { id: string; name: string } | null;
  items: Array<{
    product_id: string;
    variant_id: string | null;
    category_id: string;
    name: string;
    base_price: string;
    rule_price: string;
    fixed_price: string | null;
    price: string;
    /** Off on the channel right now: a stop on it or everywhere. */
    off: { reason: string | null; until: string | null; everywhere: boolean; chain_wide: boolean } | null;
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
  /** A category that still holds products archives only with somewhere to move them. */
  archiveCategory: async (id: string, moveTo?: string): Promise<void> => {
    await httpClient.delete(`/api/v1/categories/${id}`, { params: moveTo ? { moveTo } : undefined });
  },
  /** Sibling categories, in their new order. */
  reorderCategories: async (ids: string[]): Promise<Category[]> => {
    const res = await httpClient.put('/api/v1/categories/order', { ids });
    return res.data;
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
  /** The group editor's Save: rules, items and removals in one transaction. */
  saveOptionGroup: async (
    id: string,
    data: {
      name: string;
      min_selection: number;
      max_selection: number;
      items: { id?: string; name: string; price_delta: string; sort_order: number }[];
      removed_item_ids: string[];
    }
  ): Promise<OptionGroup> => {
    const res = await httpClient.put(`/api/v1/option-groups/${id}`, data);
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

  // Branch price lists
  getBranchPrices: async (branchId?: string | null): Promise<BranchPrices> => {
    const res = await httpClient.get('/api/v1/catalog/prices', { params: { branchId: branchId || undefined } });
    return res.data;
  },
  getPriceLists: async (): Promise<PriceList[]> => {
    const res = await httpClient.get('/api/v1/catalog/price-lists');
    return res.data;
  },
  createPriceList: async (name: string): Promise<PriceList> => {
    const res = await httpClient.post('/api/v1/catalog/price-lists', { name });
    return res.data;
  },
  updatePriceList: async (id: string, data: { name?: string; is_active?: boolean }): Promise<PriceList> => {
    const res = await httpClient.patch(`/api/v1/catalog/price-lists/${id}`, data);
    return res.data;
  },
  archivePriceList: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/catalog/price-lists/${id}`);
  },
  getPriceListSheet: async (id: string): Promise<PriceListSheet> => {
    const res = await httpClient.get(`/api/v1/catalog/price-lists/${id}/prices`);
    return res.data;
  },
  setListPrice: async (id: string, productId: string, variantId: string | null, amount: string | null): Promise<PriceListSheet> => {
    const res = await httpClient.put(`/api/v1/catalog/price-lists/${id}/prices`, { productId, variantId, amount });
    return res.data;
  },
  assignBranchPriceList: async (branchId: string, priceListId: string | null): Promise<void> => {
    await httpClient.put('/api/v1/catalog/branch-price-list', { branchId, priceListId });
  },

  // Dated price changes
  previewPriceChange: async (input: PriceChangeInput): Promise<PriceChangePreview> => {
    const res = await httpClient.post('/api/v1/catalog/price-changes/preview', input);
    return res.data;
  },
  commitPriceChange: async (input: PriceChangeInput): Promise<PriceChange> => {
    const res = await httpClient.post('/api/v1/catalog/price-changes', input);
    return res.data;
  },
  getPriceChanges: async (): Promise<PriceChange[]> => {
    const res = await httpClient.get('/api/v1/catalog/price-changes');
    return res.data;
  },
  cancelPriceChange: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/catalog/price-changes/${id}`);
  },
  getPriceHistory: async (productId: string): Promise<PriceHistoryRow[]> => {
    const res = await httpClient.get(`/api/v1/products/${productId}/price-history`);
    return res.data;
  },

  // Aggregator price sheet (Snappfood): the markup rule applied to every item, plus fixed
  // prices. With a branch, the markup starts from that branch's in-store price.
  getChannelPriceSheet: async (channel: string, branchId?: string | null): Promise<ChannelPriceSheet> => {
    const res = await httpClient.get('/api/v1/catalog/channel-prices', { params: { channel, branchId: branchId || undefined } });
    return res.data;
  },
  setChannelFixedPrice: async (
    channel: string,
    productId: string,
    variantId: string | null,
    amount: string | null,
    branchId?: string | null
  ): Promise<ChannelPriceSheet> => {
    const res = await httpClient.put('/api/v1/catalog/channel-prices', { channel, productId, variantId, amount, branchId: branchId || null });
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
  /**
   * The register's own 86. Until the next shift needs only a reason; until further notice
   * needs an approver, or an approver's pin from anyone else.
   */
  posStop: async (body: {
    productId: string;
    variantId?: string | null;
    until: 'NEXT_SHIFT' | 'FURTHER_NOTICE';
    reason: string;
    branchId?: string | null;
    approverPin?: string;
  }): Promise<ProductAvailability> => {
    const res = await httpClient.post('/api/v1/availability/pos-stop', { ...body, variantId: body.variantId || undefined, branchId: body.branchId || undefined });
    return res.data;
  },
  /** Put an item back on sale from the register: an approver, or an approver's pin. */
  posResume: async (body: { productId: string; variantId?: string | null; branchId?: string | null; approverPin?: string }): Promise<void> => {
    await httpClient.post('/api/v1/availability/pos-resume', { ...body, variantId: body.variantId || undefined, branchId: body.branchId || undefined });
  },
  bulkStop: async (
    body: BulkStopRequest & { until?: 'NEXT_SHIFT'; hours?: number; reason: string }
  ): Promise<{ products: number; branches: number; stopped: number }> => {
    const res = await httpClient.post('/api/v1/availability/bulk-stop', body);
    return res.data;
  },
  bulkResume: async (body: BulkStopRequest): Promise<{ resumed: number; chain_wide: number }> => {
    const res = await httpClient.post('/api/v1/availability/bulk-resume', body);
    return res.data;
  },
  /** Who took what off sale, for how long, and the sales refused meanwhile. Dates are YYYY-MM-DD. */
  getStopReport: async (params: { from?: string; to?: string; branchId?: string }): Promise<StopReport> => {
    const res = await httpClient.get('/api/v1/availability/report', { params });
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
    channel?: string;
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

  getNoteTemplates: async (
    scope?: NoteTemplateScope,
    includeInactive = false
  ): Promise<NoteTemplate[]> => {
    const res = await httpClient.get('/api/v1/note-templates', {
      params: { scope, includeInactive: includeInactive ? 'true' : undefined },
    });
    return res.data;
  },
  createNoteTemplate: async (data: Partial<NoteTemplate>): Promise<NoteTemplate> => {
    const res = await httpClient.post('/api/v1/note-templates', data);
    return res.data;
  },
  updateNoteTemplate: async (id: string, data: Partial<NoteTemplate>): Promise<NoteTemplate> => {
    const res = await httpClient.patch(`/api/v1/note-templates/${id}`, data);
    return res.data;
  },
  archiveNoteTemplate: async (id: string): Promise<NoteTemplate> => {
    const res = await httpClient.delete(`/api/v1/note-templates/${id}`);
    return res.data;
  },
};
