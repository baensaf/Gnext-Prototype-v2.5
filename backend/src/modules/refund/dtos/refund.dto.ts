import { IsString, IsOptional, IsUUID } from 'class-validator';

/** The refund of a completed order: all of it, back by the methods it was paid with. */
export class RefundCreateDto {
  /** One of head office's refund reasons, required on the route; its name becomes the refund's reason. */
  @IsUUID()
  reasonCodeId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  /** A manager pin, when the account asking is not itself allowed to approve. */
  @IsOptional()
  @IsString()
  pin?: string;

  /** The approver picked in the PIN dialog; only their pin is accepted. */
  @IsOptional()
  @IsUUID()
  approverId?: string;

  /** A request a manager approved by signing in on the cashier's screen (R-15). */
  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;
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
