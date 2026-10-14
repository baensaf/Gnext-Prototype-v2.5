import { IsString, IsOptional, IsUUID } from 'class-validator';

/** The refund of a completed order: all of it, back by the methods it was paid with. */
export class RefundCreateDto {
  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsString()
  reason: string;

  /** A manager pin, when the account asking is not itself allowed to approve. */
  @IsOptional()
  @IsString()
  pin?: string;

  /** The approver picked in the PIN dialog; only their pin is accepted. */
  @IsOptional()
  @IsUUID()
  approverId?: string;
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

  /** A manager pin, when the account asking is not itself allowed to approve. */
  @IsOptional()
  @IsString()
  pin?: string;

  /** The approver picked in the PIN dialog; only their pin is accepted. */
  @IsOptional()
  @IsUUID()
  approverId?: string;
}
