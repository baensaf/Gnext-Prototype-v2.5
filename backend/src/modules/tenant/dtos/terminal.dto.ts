import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * What a terminal is made of. The route took `any`, so a body with no code at all reached
 * the uniqueness check as `undefined` — which TypeORM drops from the where clause, so the
 * first terminal in the tenant came back as a match and the caller was told their code
 * already existed.
 */

export class CreateTerminalDto {
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
  terminal_type?: string;
}

export class UpdateTerminalDto {
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
  terminal_type?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
