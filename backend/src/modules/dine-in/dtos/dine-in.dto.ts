import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSectionDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateTableDto {
  @IsString()
  @IsNotEmpty()
  dining_area_id: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  table_number: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  seating_capacity?: number;

  @IsOptional()
  @IsString()
  shape?: string;

  @IsOptional()
  @IsNumber()
  pos_x?: number;

  @IsOptional()
  @IsNumber()
  pos_y?: number;
}

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  dining_area_id?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  table_number?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  seating_capacity?: number;

  @IsOptional()
  @IsString()
  shape?: string;

  @IsOptional()
  @IsNumber()
  pos_x?: number;

  @IsOptional()
  @IsNumber()
  pos_y?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class MoveTableDto {
  @IsString()
  @IsNotEmpty()
  targetTableId: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  guestCount?: number;
}

export class MergeOrdersDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  sourceOrderIds: string[];

  @IsString()
  @IsNotEmpty()
  targetOrderId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class SplitLineDto {
  @IsString()
  @IsNotEmpty()
  orderItemId: string;

  @IsNotEmpty()
  quantity: number | string;
}

export class SplitOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SplitLineDto)
  lines: SplitLineDto[];

  @IsOptional()
  @IsString()
  targetTableId?: string;

  @IsOptional()
  settlementPlan?: any;
}

export class TransferItemsDto {
  @IsString()
  @IsNotEmpty()
  sourceOrderId: string;

  @IsString()
  @IsNotEmpty()
  targetOrderId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SplitLineDto)
  lines: SplitLineDto[];

  @IsOptional()
  @IsString()
  reason?: string;
}
