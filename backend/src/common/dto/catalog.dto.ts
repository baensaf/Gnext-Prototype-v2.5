import { IsUUID, IsString, IsOptional, IsInt, Min, IsEnum } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;
}

export class CreateProductDto {
  @IsUUID()
  category_id: string;

  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsString()
  base_price: string;

  @IsOptional()
  @IsString()
  tax_rate?: string;
}

export class BulkUpdatePricesDto {
  @IsOptional()
  @IsUUID()
  price_group_id?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsEnum(['PERCENTAGE', 'FIXED'])
  adjustment_type: 'PERCENTAGE' | 'FIXED';

  @IsString()
  amount: string;
}
