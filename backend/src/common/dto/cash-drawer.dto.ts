import { IsUUID, IsString, IsOptional, IsEnum } from 'class-validator';

export class OpenShiftDto {
  @IsUUID()
  branch_id: string;

  @IsUUID()
  terminal_id: string;

  @IsOptional()
  @IsUUID()
  user_id?: string;

  @IsString()
  opening_float: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export enum CashTxType {
  PAY_IN = 'PAY_IN',
  PAY_OUT = 'PAY_OUT',
  SAFE_DROP = 'SAFE_DROP',
}

export class PostCashTxDto {
  @IsEnum(CashTxType)
  transaction_type: CashTxType;

  @IsString()
  amount: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CloseShiftDto {
  @IsString()
  actual_cash: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
