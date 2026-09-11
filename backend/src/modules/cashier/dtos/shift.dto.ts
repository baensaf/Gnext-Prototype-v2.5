import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  IsNumberString,
  IsIn,
} from 'class-validator';

export class ShiftOpenDto {
  @IsUUID()
  terminalId: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @IsNumberString()
  openingCash?: string;

  @IsOptional()
  @IsNumberString()
  openingFloat?: string;

  @IsOptional()
  @IsString()
  businessDate?: string;
}

export class CashMovementDto {
  @IsString()
  @IsIn(['PAID_IN', 'PAID_OUT'])
  type: 'PAID_IN' | 'PAID_OUT';

  @IsNumberString()
  amount: string;

  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  reasonText?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsInt()
  version?: number;
}

export class ShiftBeginCloseDto {
  @IsOptional()
  @IsInt()
  version?: number;
}

export class ShiftReturnToOpenDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsInt()
  version?: number;
}

export class ShiftCloseDto {
  @IsNumberString()
  actualCash: string;

  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;

  @IsOptional()
  @IsString()
  previewVersion?: string;

  /** An approver's pin, when the count is further out than the branch's tolerance. */
  @IsOptional()
  @IsString()
  pin?: string;

  @IsOptional()
  @IsInt()
  version?: number;
}

export class BusinessDayCloseDto {
  @IsUUID()
  branchId: string;

  @IsString()
  businessDate: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;
}

export class BusinessDayReopenDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  /**
   * Was required, and the screen sent the literal `appr-auto` in it. Reopening is a
   * manager's act now (the route says so), recorded with their reason; kept optional so an
   * older client naming a real request still gets it stored.
   */
  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;

  @IsOptional()
  @IsInt()
  version?: number;
}
