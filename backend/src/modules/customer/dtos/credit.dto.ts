import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  IsNumberString,
  IsIn,
} from 'class-validator';

export class CreditAccountCreateDto {
  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @IsString()
  @IsIn(['FINITE', 'UNLIMITED', 'POLICY'])
  mode?: 'FINITE' | 'UNLIMITED' | 'POLICY';

  @IsOptional()
  @IsNumberString()
  creditLimit?: string;

  @IsOptional()
  @IsString()
  policyNote?: string;
}

export class CreditAccountUpdateDto {
  @IsOptional()
  @IsString()
  @IsIn(['FINITE', 'UNLIMITED', 'POLICY'])
  mode?: 'FINITE' | 'UNLIMITED' | 'POLICY';

  @IsOptional()
  @IsNumberString()
  creditLimit?: string;

  @IsOptional()
  @IsString()
  policyNote?: string;

  @IsOptional()
  @IsString()
  approvalRequestId?: string;

  @IsOptional()
  @IsInt()
  version?: number;
}

export class CreditAccountStatusDto {
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  approvalRequestId?: string;

  @IsOptional()
  @IsInt()
  version?: number;
}

export class CreditRepaymentDto {
  @IsNumberString()
  amount: string;

  /**
   * Set by the refund service, never by a client (the validation pipe refuses unknown fields):
   * a refund to store credit was already released by a manager or a manager's PIN.
   */
  preApproved?: boolean;

  @IsOptional()
  @IsString()
  methodId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  approvalRequestId?: string;

  @IsOptional()
  @IsInt()
  version?: number;
}

export class CreditAdjustmentDto {
  @IsNumberString()
  amountSigned: string;

  @IsOptional()
  @IsString()
  reasonCodeId?: string;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsString()
  approvalRequestId: string;

  @IsOptional()
  @IsInt()
  version?: number;
}

export class CreditPurchaseDto {
  @IsUUID()
  orderId: string;

  @IsNumberString()
  amount: string;

  @IsOptional()
  @IsUUID()
  paymentId?: string;

  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;

  @IsOptional()
  @IsString()
  businessDate?: string;
}
