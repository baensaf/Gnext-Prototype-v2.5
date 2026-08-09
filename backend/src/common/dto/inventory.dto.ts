import { IsUUID, IsString, IsOptional, IsEnum } from 'class-validator';

export enum InventoryTxType {
  PURCHASE_RECEIPT = 'PURCHASE_RECEIPT',
  ADJUSTMENT = 'ADJUSTMENT',
  WASTE = 'WASTE',
  TRANSFER = 'TRANSFER',
}

export class PostInventoryTxDto {
  @IsUUID()
  inventory_item_id: string;

  @IsEnum(InventoryTxType)
  transaction_type: InventoryTxType;

  @IsString()
  quantity_delta: string;

  @IsOptional()
  @IsUUID()
  reason_code_id?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
