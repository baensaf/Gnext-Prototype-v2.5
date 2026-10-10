import {
  IsString,
  IsOptional,
  IsUUID,
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
}

export class CreditRepaymentDto {
  @IsNumberString()
  amount: string;

  /**
   * Set by the refund service, never by a client (the validation pipe refuses unknown fields):
   * a refund to store credit was already released by a manager or a manager's PIN, and may
   * leave the balance above what was owed.
   */
  preApproved?: boolean;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  reason?: string;
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
  @IsString()
  businessDate?: string;
}
