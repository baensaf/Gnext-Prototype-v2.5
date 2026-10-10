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
