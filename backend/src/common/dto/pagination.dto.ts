import { IsOptional, IsInt, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'ASC';
}

export interface PagedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function createPagedResponse<T>(
  items: T[],
  total: number,
  page: number = 1,
  limit: number = 20,
): PagedResponse<T> {
  const p = Math.max(1, page);
  const l = Math.max(1, limit);
  return {
    items,
    total,
    page: p,
    limit: l,
    totalPages: Math.ceil(total / l),
  };
}
