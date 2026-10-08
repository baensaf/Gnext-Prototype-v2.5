import { IsString, IsOptional, IsUUID, IsNumberString, IsBoolean } from 'class-validator';

export class RefundCreateDto {
  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsBoolean()
  full?: boolean;

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

/** How a refund is settled. Internal: the register creates and settles a refund in one call. */
export interface RefundProcessOptions {
  scenarioId?: string;
  externalReference?: string;
  /** Who released the money, recorded on the refund's audit event. */
  approvedBy?: string | null;
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
