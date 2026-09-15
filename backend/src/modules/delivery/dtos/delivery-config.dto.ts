import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min, ValidateIf } from 'class-validator';
import { COURIER_PAY_MODES } from '../courier-pay';

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

  /** What a courier on the zone-rate pay rule earns per trip here. */
  @IsOptional()
  @IsString()
  courier_pay?: string;

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

  /** Left out, the courier starts on the branch's COURIER_PAY default. */
  @IsOptional()
  @IsIn(COURIER_PAY_MODES)
  pay_mode?: string;

  @IsOptional()
  @IsString()
  currency_code?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateZoneDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  fee?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimated_minutes?: number;

  /** An empty value clears the rate, so couriers on the zone-rate rule fall back to their own. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  courier_pay?: string | null;
}

export class UpdateCourierPayDto {
  @IsIn(COURIER_PAY_MODES)
  pay_mode: string;

  @IsOptional()
  @IsString()
  compensation_per_delivery?: string;
}
