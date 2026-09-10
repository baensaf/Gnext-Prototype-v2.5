import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * What a delivery zone and a courier are made of.
 *
 * These routes took `any`, so the global validation pipe had nothing to check and an empty
 * body reached the database as a row of nulls — the caller got a 500 and a stack trace
 * about a not-null constraint instead of being told which field was missing.
 *
 * A zone names its branch outright rather than falling back to one: for a branch account
 * the scope interceptor has already rewritten it to their own, and for head office there
 * is no sensible default shop to put it in.
 */

export class CreateZoneDto {
  @IsUUID()
  branch_id: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  fee?: string;

  @IsOptional()
  @IsString()
  currency_code?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimated_minutes?: number;

  @IsOptional()
  polygon?: any;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  postal_prefixes?: string[];
}

export class CreateCourierDto {
  /** A courier may work for the chain rather than one shop, so this one is optional. */
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  vehicle_type?: string;

  @IsOptional()
  @IsString()
  compensation_per_delivery?: string;

  @IsOptional()
  @IsString()
  currency_code?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
