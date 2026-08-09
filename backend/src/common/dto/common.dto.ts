import { IsUUID, IsString, IsOptional, IsInt, Min } from 'class-validator';

export class IdParamDto {
  @IsUUID()
  id: string;
}

export class CodeParamDto {
  @IsString()
  code: string;
}

export class EntityVersionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
