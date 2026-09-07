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
  manualDiscount?: any;

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
  manualDiscount?: any;

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

export class OrderEditDto {
  @IsOptional()
  changes?: any;

  @IsOptional()
  @IsString()
  quoteVersion?: string;

  @IsOptional()
  refundPlan?: any;
}

export class OrderItemReplaceDto {
  @IsUUID()
  orderItemId: string;

  @IsOptional()
  replacement?: any;

  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  quoteVersion?: string;
}

export class OrderCancelDto {
  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

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
