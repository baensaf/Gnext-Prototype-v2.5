import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsNumberString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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

