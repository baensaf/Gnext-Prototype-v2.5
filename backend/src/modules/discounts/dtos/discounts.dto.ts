import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  IsNumberString,
  IsUUID,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  FREE_ITEM = 'FREE_ITEM',
  FREE_DELIVERY = 'FREE_DELIVERY',
}

export enum ScopeType {
  BRANCH = 'BRANCH',
  CUSTOMER = 'CUSTOMER',
  CUSTOMER_TAG = 'CUSTOMER_TAG',
  CUSTOMER_SEGMENT = 'CUSTOMER_SEGMENT',
  PRODUCT = 'PRODUCT',
  CATEGORY = 'CATEGORY',
  CHANNEL = 'CHANNEL',
  ORDER_TYPE = 'ORDER_TYPE',
}

export class CreateDiscountCampaignDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(DiscountType)
  discount_type: DiscountType;

  @IsOptional()
  @IsNumberString()
  percentage?: string;

  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsString()
  currency_code?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  priority?: number;

  @IsOptional()
  @IsString()
  stacking_group?: string;

  @IsOptional()
  @IsBoolean()
  is_stackable?: boolean;

  @IsOptional()
  @IsBoolean()
  coupon_required?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  usage_limit_total?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  usage_limit_per_customer?: number;

  @IsOptional()
  @IsString()
  effective_from?: string;

  @IsOptional()
  @IsString()
  effective_to?: string;

  @IsOptional()
  @IsNumberString()
  minimum_subtotal?: string;

  @IsOptional()
  @IsNumberString()
  maximum_discount_amount?: string;

  @IsOptional()
  @IsUUID()
  reward_product_id?: string;

  @IsOptional()
  @IsNumberString()
  reward_quantity?: string;

  @IsOptional()
  @IsString()
  funding_source?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateDiscountCampaignDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(DiscountType)
  discount_type?: DiscountType;

  @IsOptional()
  @IsNumberString()
  percentage?: string;

  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsString()
  currency_code?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  priority?: number;

  @IsOptional()
  @IsString()
  stacking_group?: string;

  @IsOptional()
  @IsBoolean()
  is_stackable?: boolean;

  @IsOptional()
  @IsBoolean()
  coupon_required?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  usage_limit_total?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  usage_limit_per_customer?: number;

  @IsOptional()
  @IsString()
  effective_from?: string;

  @IsOptional()
  @IsString()
  effective_to?: string;

  @IsOptional()
  @IsNumberString()
  minimum_subtotal?: string;

  @IsOptional()
  @IsNumberString()
  maximum_discount_amount?: string;

  @IsOptional()
  @IsUUID()
  reward_product_id?: string;

  @IsOptional()
  @IsNumberString()
  reward_quantity?: string;

  @IsOptional()
  @IsString()
  funding_source?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateDiscountScopeDto {
  @IsEnum(ScopeType)
  scope_type: ScopeType;

  @IsOptional()
  @IsString()
  scope_id?: string;

  @IsOptional()
  @IsBoolean()
  is_exclusion?: boolean;
}

export class CreateCouponDto {
  @IsString()
  @IsNotEmpty()
  campaign_id: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_uses?: number;

  @IsOptional()
  @IsString()
  effective_from?: string;

  @IsOptional()
  @IsString()
  effective_to?: string;
}

export class QuoteItemDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsNotEmpty()
  @IsNumberString()
  unitPrice: string;

  @IsNotEmpty()
  @IsNumberString()
  quantity: string;

  @IsOptional()
  @IsNumberString()
  taxRate?: string;

  @IsOptional()
  @IsBoolean()
  neverDiscount?: boolean;

  @IsOptional()
  @IsBoolean()
  campaignExcluded?: boolean;

  @IsOptional()
  @IsBoolean()
  ownNonStackableApplied?: boolean;
}

export class ManualDiscountDto {
  @IsEnum(['PERCENTAGE', 'FIXED_AMOUNT'])
  calculation_type: 'PERCENTAGE' | 'FIXED_AMOUNT';

  @IsNotEmpty()
  @IsNumberString()
  value: string;

  @IsOptional()
  @IsString()
  reasonCode?: string;

  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;
}

export class DiscountQuoteRequestDto {
  @IsNotEmpty()
  orderDraft: {
    items: QuoteItemDto[];
    branchId?: string;
    customerId?: string;
    customerTagIds?: string[];
    customerSegmentIds?: string[];
    channel?: string;
    orderType?: string;
    deliveryFee?: string;
    currencyCode?: string;
  };

  @IsOptional()
  @ValidateNested()
  @Type(() => ManualDiscountDto)
  manualDiscount?: ManualDiscountDto;

  @IsOptional()
  @IsString()
  couponCode?: string;
}

export class CreateCustomerDiscountDto {
  @IsUUID()
  @IsNotEmpty()
  customer_id: string;

  @IsNumberString()
  @IsNotEmpty()
  discount_percentage: string;

  @IsOptional()
  @IsString()
  effective_from?: string;

  @IsOptional()
  @IsString()
  effective_to?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateCustomerDiscountDto {
  @IsOptional()
  @IsNumberString()
  discount_percentage?: string;

  @IsOptional()
  @IsString()
  effective_from?: string;

  @IsOptional()
  @IsString()
  effective_to?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateOneTimeCouponDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsNumberString()
  @IsNotEmpty()
  percentage: string;

  @IsOptional()
  @IsNumberString()
  minimum_subtotal?: string;

  @IsOptional()
  @IsNumberString()
  maximum_discount_amount?: string;

  @IsOptional()
  @IsString()
  effective_from?: string;

  @IsOptional()
  @IsString()
  effective_to?: string;
}

