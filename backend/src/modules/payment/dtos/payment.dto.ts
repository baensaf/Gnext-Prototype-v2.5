import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsNumberString,
  IsIn,
  IsBoolean,
  IsObject,
  MaxLength,
} from 'class-validator';

export class PaymentCreateDto {
  @IsUUID()
  orderId: string;

  @IsUUID()
  methodId: string;

  @IsNumberString()
  amount: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsUUID()
  settlementAccountId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  receiptNumber?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class PaymentProcessDto {
  @IsOptional()
  @IsString()
  scenarioId?: string;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsOptional()
  @IsString()
  receiptNumber?: string;
}

export class PaymentCorrectionDto {
  @IsString()
  reason: string;

  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @IsUUID()
  replacementMethodId: string;

  @IsOptional()
  @IsNumberString()
  replacementAmount?: string;

  @IsOptional()
  @IsUUID()
  approvalRequestId?: string;
}

export class PaymentDeviceCreateDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsString()
  @IsIn(['POS', 'NETWORK', 'MOBILE'])
  kind: 'POS' | 'NETWORK' | 'MOBILE';

  @IsOptional()
  @IsString()
  @IsIn(['COMPANY', 'COURIER', 'THIRD_PARTY'])
  ownership?: 'COMPANY' | 'COURIER' | 'THIRD_PARTY';

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  settlementAccountId?: string;

  @IsOptional()
  @IsString()
  deviceIdentifier?: string;
}

export class PaymentDeviceAgentDto {
  /** `{ kind: 'tcp', host, port }` or `{ kind: 'serial', port, baud }`; null takes the terminal off the agent. */
  @IsOptional()
  @IsObject()
  agentConnection?: Record<string, any> | null;

  @IsOptional()
  @IsString()
  agentDriver?: string | null;
}

export class TerminalResolutionDto {
  @IsIn(['APPROVED', 'NOT_CHARGED'])
  outcome: 'APPROVED' | 'NOT_CHARGED';

  @IsOptional()
  @IsString()
  @MaxLength(160)
  rrn?: string;

  @IsString()
  @MaxLength(500)
  reason: string;
}

export class SettlementAccountCreateDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsString()
  accountType: string;

  @IsOptional()
  @IsString()
  maskedIdentifier?: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @IsBoolean()
  isCompanyOwned?: boolean;
}
