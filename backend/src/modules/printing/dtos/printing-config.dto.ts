import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * What a printer, a printer group and a print route are made of.
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

  @IsString()
  @IsNotEmpty()
  code: string;

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
  @BlankIsNothing()
  @IsUUID()
  fallback_printer_id?: string;

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
  @BlankIsNothing()
  @IsUUID()
  fallback_printer_id?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class PrinterGroupMemberDto {
  @IsUUID()
  printer_id: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  copies?: number;
}

export class CreatePrinterGroupDto {
  @IsUUID()
  branch_id: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrinterGroupMemberDto)
  members?: PrinterGroupMemberDto[];
}

export class UpdatePrinterGroupDto {
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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrinterGroupMemberDto)
  members?: PrinterGroupMemberDto[];
}

export class CreatePrintRouteDto {
  @IsUUID()
  branch_id: string;

  @IsUUID()
  printer_group_id: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  document_type?: string;

  @IsOptional()
  @BlankIsNothing()
  @IsUUID()
  product_id?: string;

  @IsOptional()
  @BlankIsNothing()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @BlankIsNothing()
  @IsUUID()
  station_id?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  copies?: number;
}

export class UpdatePrintRouteDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  printer_group_id?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  document_type?: string;

  @IsOptional()
  @BlankIsNothing()
  @IsUUID()
  product_id?: string;

  @IsOptional()
  @BlankIsNothing()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @BlankIsNothing()
  @IsUUID()
  station_id?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  copies?: number;
}
