import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  IsNumberString,
  IsBoolean,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RefundItemDto {
  @IsUUID()
  orderItemId: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  quantity: number;
}

export class RefundCreateDto {
  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsBoolean()
  full?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RefundItemDto)
  items?: RefundItemDto[];

  @IsOptional()
  @IsUUID()
  targetMethodId?: string;

  /**
   * Set by the controller, never by the client (the validation pipe refuses unknown fields):
   * the money going out was already released by a manager or a manager's PIN, which covers
   * paying it back by another method than the customer paid with.
   */
  moneyOutAuthorized?: boolean;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsString()
  reason: string;

  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;

  @IsOptional()
  @IsString()
  scenarioId?: string;

  /** A manager pin, when the account asking is not itself allowed to approve. */
  @IsOptional()
  @IsString()
  pin?: string;
}

export class RefundProcessDto {
  @IsOptional()
  @IsString()
  scenarioId?: string;

  @IsOptional()
  @IsString()
  externalReference?: string;

  /** A manager pin, when the account asking is not itself allowed to approve. */
  @IsOptional()
  @IsString()
  pin?: string;
}

export class PaidOrderCancelDto {
  @IsString()
  reason: string;

  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;

  @IsOptional()
  @IsUUID()
  targetMethodId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  /** A manager pin, when the account asking is not itself allowed to approve. */
  @IsOptional()
  @IsString()
  pin?: string;
}

export class RefundReversalDto {
  @IsString()
  reason: string;

  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsUUID()
  approvalRequestId: string;

  /** A manager pin, when the account asking is not itself allowed to approve. */
  @IsOptional()
  @IsString()
  pin?: string;
}
