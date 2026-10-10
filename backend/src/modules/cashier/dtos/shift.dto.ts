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

export class ShiftCloseDto {
  @IsNumberString()
  actualCash: string;

  /**
   * Of the counted cash, what stays in the drawer as the next shift's float. The rest is handed
   * over. Left out, the drawer is emptied.
   */
  @IsOptional()
  @IsNumberString()
  leftInDrawer?: string;

  @IsOptional()
  @IsInt()
  version?: number;
}
