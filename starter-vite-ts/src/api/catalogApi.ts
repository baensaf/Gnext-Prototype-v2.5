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
  barcode?: string;
  base_price: string;
  is_default: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface Product {
  id: string;
  /** Optional: chains fill it to search or re-import by; blank for most shops. */
  code?: string | null;
  barcode?: string | null;
  name: string;
  description?: string;
  category_id: string;
  unit_of_measure: string;
  tax_rate: string;
  /** The main photo; null once every photo is removed. */
  image_asset_id?: string | null;
  is_active: boolean;
  base_price: string;
  /** Most units one order may hold; null for no cap. */
  max_per_order?: number | null;
  /** Photos after the main one, in order. */
  gallery_asset_ids?: string[];
  /** Its place in its category; null until a category is put in order. */
  sort_order?: number | null;
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
  sort_order: number;
}

export interface OptionGroup {
  id: string;
  code: string;
  name: string;
  min_selection: number;
  max_selection: number;
  /** Always `min_selection > 0`: a required group, which the POS asks for. */
  is_required: boolean;
  items?: OptionItem[];
  /** On a product's own groups: the choices switched off on this product. */
  excluded_item_ids?: string[];
  /** On the add-on groups list: the products that carry the group. */
  product_ids?: string[];
}

/** What the add-on group form saves: the group, its choices and the choices it drops. */
export interface OptionGroupDraft {
  name: string;
  min_selection: number;
  max_selection: number;
  items: { id?: string; name: string; price_delta: string }[];
  removed_item_ids: string[];
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

/** A price change: base prices or one list, by a percentage or an amount. It applies at once. */
export interface PriceChangeInput {
  price_list_id?: string | null;
  category_id?: string | null;
  adjustment: 'PERCENT' | 'AMOUNT';
  value: string;
  round_to?: number | null;
}

export interface PriceChangePreview {
  price_list: { id: string; name: string } | null;
  items: Array<{ product_id: string; variant_id: string | null; name: string; current: string; new: string }>;
  changed: number;
}

export interface PriceChange {
  id: string;
  status: 'APPLIED';
  price_list: { id: string; name: string | null } | null;
  effective_from: string;
  items: number;
  adjustment: 'PERCENT' | 'AMOUNT';
  value: string;
  round_to: number;
  category_id: string | null;
  created_at: string;
}

export interface PriceHistoryRow {
  at: string;
  until: string | null;
  /** CHANGE: a price change; LIST_PRICE: set on a price list; EDIT: typed on the product page. */
  kind: 'CHANGE' | 'LIST_PRICE' | 'BASE' | 'EDIT';
  price_list: string | null;
  size: string | null;
  from: string | null;
  to: string;
  status: 'UPCOMING' | 'CURRENT' | 'ENDED' | null;
}

/** A stop on many items or branches: a category or products; branches empty = chain-wide (head office). */
export interface BulkStopRequest {
  categoryId?: string;
  productIds?: string[];
  branchIds?: string[];
  channel?: string;
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

/** What a stop is on and how long it lasts. */
export interface StopRequest {
  productId?: string;
  variantId?: string;
  optionItemId?: string;
  branchId?: string;
  /** Off on this channel only (SNAPPFOOD); empty for everywhere. */
  channel?: string;
  /** Until the next shift (ends by itself at the next business day) or until further notice (the default). */
  until?: StopUntil;
}

/** Snappfood's two kinds of "ناموجود". */
export type StopUntil = 'NEXT_SHIFT' | 'FURTHER_NOTICE';

export interface ChannelPriceSheet {
  channel: string;
  rule: {
    markup_percent: number;
    round_to: number;
  };
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
  /** A category's products in their new order (Snappfood's "ترتیب محصولات"). */
  reorderProducts: async (categoryId: string, ids: string[]): Promise<void> => {
    await httpClient.put(`/api/v1/categories/${categoryId}/products/order`, { ids });
  },
  archiveProduct: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/products/${id}`);
  },
  /**
   * The switches on a product's add-ons page, for one group: the choices this product offers.
   * The first one on puts the group on the product; none takes it off.
   */
  setOfferedChoices: async (productId: string, groupId: string, offeredItemIds: string[]): Promise<{ attached: boolean; excluded_item_ids: string[] }> => {
    const res = await httpClient.put(`/api/v1/products/${productId}/option-groups/${groupId}/choices`, { offeredItemIds });
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
  /** The group form's Save: name, choices, removals and rule in one transaction. No id creates the group. */
  saveOptionGroup: async (id: string | null, data: OptionGroupDraft): Promise<OptionGroup> => {
    const res = id ? await httpClient.put(`/api/v1/option-groups/${id}`, data) : await httpClient.post('/api/v1/option-groups', data);
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

  // Price changes
  previewPriceChange: async (input: PriceChangeInput): Promise<PriceChangePreview> => {
    const res = await httpClient.post('/api/v1/catalog/price-changes/preview', input);
    return res.data;
  },
  commitPriceChange: async (input: PriceChangeInput): Promise<PriceChange> => {
    const res = await httpClient.post('/api/v1/catalog/price-changes', input);
    return res.data;
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
  resumeProduct: async (productId: string, branchId?: string): Promise<any> => {
    const res = await httpClient.post('/api/v1/availability/resume', { productId, branchId });
    return res.data;
  },
  /** The register's own 86: off until somebody puts it back, no reason, no pin. */
  posStop: async (body: { productId: string; variantId?: string | null; branchId?: string | null; until?: StopUntil }): Promise<ProductAvailability> => {
    const res = await httpClient.post('/api/v1/availability/pos-stop', { ...body, variantId: body.variantId || undefined, branchId: body.branchId || undefined });
    return res.data;
  },
  /** Put an item back on sale from the register. */
  posResume: async (body: { productId: string; variantId?: string | null; branchId?: string | null }): Promise<void> => {
    await httpClient.post('/api/v1/availability/pos-resume', { ...body, variantId: body.variantId || undefined, branchId: body.branchId || undefined });
  },
  bulkStop: async (
    body: BulkStopRequest
  ): Promise<{ products: number; branches: number; stopped: number }> => {
    const res = await httpClient.post('/api/v1/availability/bulk-stop', body);
    return res.data;
  },
  bulkResume: async (body: BulkStopRequest): Promise<{ resumed: number; chain_wide: number }> => {
    const res = await httpClient.post('/api/v1/availability/bulk-resume', body);
    return res.data;
  },
  /** Take a product, one variant or an add-on off sale, Snappfood-style. */
  stopItem: async (target: StopRequest): Promise<ProductAvailability> => {
    const res = await httpClient.post('/api/v1/availability/suspend', target);
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
