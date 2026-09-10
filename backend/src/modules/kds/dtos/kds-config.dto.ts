import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * What a kitchen station, a screen and a routing rule are made of.
 *
 * All three took `any`. A station created without a branch failed on a not-null constraint
 * deep in the driver, which is how the configuration screen's own "add station" button
 * behaved: it never sent one. Naming the branch here is what makes that visible.
 */

export class CreateStationDto {
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
  station_type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  target_minutes?: number;
}

export class UpdateStationDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  station_type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  target_minutes?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateScreenDto {
  @IsUUID()
  branch_id: string;

  @IsOptional()
  @IsUUID()
  terminal_id?: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  station_ids?: string[];
}

export class UpdateScreenDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  terminal_id?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  station_ids?: string[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateRoutingRuleDto {
  @IsUUID()
  branch_id: string;

  @IsUUID()
  station_id: string;

  /** Exactly one of these two; the service says which, because "exactly one" is its rule. */
  @IsOptional()
  @IsUUID()
  product_id?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsInt()
  priority?: number;
}
