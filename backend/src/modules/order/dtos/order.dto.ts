import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  IsArray,
  ValidateNested,
  Min,
  IsNumberString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ManualDiscountDto } from '../../discounts/dtos/discounts.dto';

export class OrderItemOptionDto {
  @IsUUID()
  option_item_id: string;

  @IsOptional()
  @IsNumberString()
  quantity?: string;

  @IsOptional()
  @IsNumberString()
  price_delta?: string;
}

export class OrderItemCreateDto {
  @IsUUID()
  product_id: string;

  @IsOptional()
  @IsUUID()
  variant_id?: string;

  @IsOptional()
  @IsString()
  variant_name?: string;

  @IsOptional()
  @IsNumberString()
  unit_price?: string;

  @IsOptional()
  @IsNumberString()
  quantity?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemOptionDto)
  options?: OrderItemOptionDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class OrderCreateDto {
  @IsUUID()
  branch_id: string;

  @IsOptional()
  @IsUUID()
  terminal_id?: string;

  @IsOptional()
  @IsUUID()
  shift_id?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  order_type?: string;

  @IsOptional()
  @IsString()
  currency_code?: string;

  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsUUID()
  table_id?: string;

  @IsOptional()
  @IsString()
  table_number?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  guest_count?: number;

  @IsOptional()
  @IsUUID()
  delivery_address_id?: string;

  @IsOptional()
  @IsUUID()
  delivery_zone_id?: string;

  @IsOptional()
  @IsString()
  coupon_code?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemCreateDto)
  items?: OrderItemCreateDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class OrderUpdateDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  terminal_id?: string;

  @IsOptional()
  @IsUUID()
  shift_id?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  order_type?: string;

  @IsOptional()
  @IsString()
  currency_code?: string;

  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsUUID()
  table_id?: string;

  @IsOptional()
  @IsString()
  table_number?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  guest_count?: number;

  @IsOptional()
  @IsUUID()
  delivery_address_id?: string;

  @IsOptional()
  @IsUUID()
  delivery_zone_id?: string;

  @IsOptional()
  @IsString()
  coupon_code?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemCreateDto)
  items?: OrderItemCreateDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  version?: number;
}

export class OrderQuoteRequestDto {
  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ManualDiscountDto)
  manualDiscount?: ManualDiscountDto;

  @IsOptional()
  @IsString()
  deliveryZoneId?: string;

  @IsOptional()
  @IsString()
  version?: string;
}

export class OrderSubmitDto {
  @IsOptional()
  @IsString()
  quoteVersion?: string;

  @IsOptional()
  @IsArray()
  approvalRequestIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ManualDiscountDto)
  manualDiscount?: ManualDiscountDto;

  @IsOptional()
  @IsInt()
  version?: number;
}

export class OrderTransitionDto {
  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsOptional()
  @IsString()
  reasonText?: string;

  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;
}

export class OrderEditVoidLineDto {
  @IsUUID()
  orderItemId: string;

  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * Line changes for an order past DRAFT. Lines are never mutated in place: a
 * removal marks the original VOID and leaves it queryable, and an addition
 * appends. Changing a quantity or a product is a supersession, which is what
 * `POST /orders/:id/replace-item` is for.
 */
export class OrderEditChangesDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemCreateDto)
  add?: OrderItemCreateDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderEditVoidLineDto)
  void?: OrderEditVoidLineDto[];
}

export class OrderEditDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderEditChangesDto)
  changes?: OrderEditChangesDto;

  @IsOptional()
  @IsString()
  quoteVersion?: string;

  /** Required when the edit policy escalates any requested change. */
  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;

  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  refundPlan?: any;
}

export class OrderItemReplaceDto {
  @IsUUID()
  orderItemId: string;

  /**
   * Replacement line. Note there is deliberately no unit price here: spec 7.9
   * requires the replacement to be priced at the current effective catalog
   * price, so a caller cannot name its own figure.
   */
  @IsOptional()
  replacement?: {
    productId?: string;
    variantId?: string;
    quantity?: string;
    options?: any[];
    notes?: string;
  };

  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  quoteVersion?: string;

  /** Required when the edit policy escalates the replacement. */
  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;

  @IsOptional()
  refundPlan?: any;
}

export class OrderCancelDto {
  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  /** Required once the cancel window has elapsed or preparation has started. */
  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;

  @IsOptional()
  refundPlan?: any;
}

export class OrderReopenDto {
  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;

  @IsOptional()
  @IsInt()
  version?: number;
}
