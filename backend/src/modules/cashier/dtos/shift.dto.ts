import {
  IsString,
  IsOptional,
  IsUUID,
  IsInt,
  IsNumberString,
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
