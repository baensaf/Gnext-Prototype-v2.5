import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * What a printer is made of.
 *
 * Every one of these routes took `any` and answered an empty body with a 500 from the
 * not-null constraints underneath.
 */

/**
 * An empty string means "nothing chosen", not a record whose id happens to be blank. The
 * forms send it for every optional printer and selector; the create paths already read it
 * as null, the update paths did not, and it reached postgres as a uuid and failed there.
 */
const BlankIsNothing = () => Transform(({ value }) => (value === '' ? null : value));

export class CreatePrinterDto {
  @IsUUID()
  branch_id: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  printer_type?: string;

  @IsOptional()
  @IsString()
  simulated_address?: string;

  /** How the branch agent reaches the printer; empty for the simulator. Checked by parseDeviceConnection. */
  @IsOptional()
  @IsObject()
  agent_connection?: Record<string, any> | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  paper_width_mm?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdatePrinterDto {
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
  printer_type?: string;

  @IsOptional()
  @IsString()
  simulated_address?: string;

  /** How the branch agent reaches the printer; empty for the simulator. Checked by parseDeviceConnection. */
  @IsOptional()
  @IsObject()
  agent_connection?: Record<string, any> | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  paper_width_mm?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  prints_whole_order?: boolean;
}

/** Everything one printer prints: whole categories, and single products. Replaces what it had. */
export class SetPrinterRoutesDto {
  @IsOptional()
  @IsUUID('all', { each: true })
  category_ids?: string[];

  @IsOptional()
  @IsUUID('all', { each: true })
  product_ids?: string[];
}

/** What prints in no kitchen at a branch: whole categories, and single products. Replaces the list. */
export class SetNotPrintedDto {
  @IsUUID()
  branch_id: string;

  @IsOptional()
  @IsUUID('all', { each: true })
  category_ids?: string[];

  @IsOptional()
  @IsUUID('all', { each: true })
  product_ids?: string[];
}

/** A made-up order to see which chits it would print, without printing anything. */
export class PreviewKitchenChitsDto {
  @IsUUID()
  branch_id: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  product_ids: string[];

  @IsOptional()
  @IsString()
  order_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}
