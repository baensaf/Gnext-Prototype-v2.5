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

  /**
   * The item discount this line already has (an order line keeps the one it was given), in
   * percent; null for none. Left out, the engine looks up today's discount for the product.
   */
  @IsOptional()
  itemDiscountPercent?: string | null;

  @IsOptional()
  itemDiscountId?: string | null;
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
    /** The cashier took the customer's friends-and-family rate off this order. */
    skipCustomerDiscount?: boolean;
  };

  @IsOptional()
  @ValidateNested()
  @Type(() => ManualDiscountDto)
  manualDiscount?: ManualDiscountDto;

  /** A one-time coupon code typed at the till; it is the order's one discount when it works. */
  @IsOptional()
  @IsString()
  couponCode?: string;
}

export class CreateCustomerDiscountDto {
  @IsUUID()
  @IsNotEmpty()
  customer_id: string;

  /** The branch whose friend or family member this is. A branch account always gets its own. */
  @IsOptional()
  @IsUUID()
  branch_id?: string;

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
