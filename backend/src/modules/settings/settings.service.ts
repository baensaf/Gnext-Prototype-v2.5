import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { Currency } from '../../entities/Currency.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { ReasonCode } from '../../entities/ReasonCode.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { MoneyUtil } from '../../common/utils/money.util';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(TenantSetting) private readonly settingRepo: Repository<TenantSetting>,
    @InjectRepository(Currency) private readonly currencyRepo: Repository<Currency>,
    @InjectRepository(PaymentMethod) private readonly methodRepo: Repository<PaymentMethod>,
    @InjectRepository(ReasonCode) private readonly reasonRepo: Repository<ReasonCode>,
    private readonly auditWriter: AuditWriter,
  ) {}

  validateGroupSettingValue(key: string, value: Record<string, any>) {
    if (!value || typeof value !== 'object') {
      throw new BadRequestException(`Setting group ${key} value must be an object`);
    }

    const group = key.toUpperCase();
    if (group === 'TAX') {
      if (value.tax_enabled !== undefined && typeof value.tax_enabled !== 'boolean') {
        throw new BadRequestException('TAX setting property tax_enabled must be a boolean');
      }
      if (value.prices_include_tax !== undefined && typeof value.prices_include_tax !== 'boolean') {
        throw new BadRequestException('TAX setting property prices_include_tax must be a boolean');
      }
    } else if (group === 'POS') {
      if (value.allow_negative_inventory !== undefined && typeof value.allow_negative_inventory !== 'boolean') {
        throw new BadRequestException('POS setting property allow_negative_inventory must be a boolean');
      }
      if (value.max_discount_percentage !== undefined) {
        if (
          !MoneyUtil.isValid(value.max_discount_percentage) ||
          MoneyUtil.lessThan(value.max_discount_percentage, '0') ||
          MoneyUtil.greaterThan(value.max_discount_percentage, '100')
        ) {
          throw new BadRequestException('POS setting property max_discount_percentage must be between 0 and 100');
        }
      }
    } else if (group === 'FINANCIAL') {
      if (value.base_currency !== undefined && (typeof value.base_currency !== 'string' || value.base_currency.length !== 3)) {
        throw new BadRequestException('FINANCIAL setting property base_currency must be a 3-letter currency code');
      }
      if (value.fiscal_year_start_month !== undefined) {
        const m = Number(value.fiscal_year_start_month);
        if (!Number.isInteger(m) || m < 1 || m > 12) {
          throw new BadRequestException('FINANCIAL setting property fiscal_year_start_month must be an integer between 1 and 12');
        }
      }
    } else if (group === 'SYSTEM') {
      if (value.auto_logout_minutes !== undefined) {
        const mins = Number(value.auto_logout_minutes);
        if (isNaN(mins) || mins < 0) {
          throw new BadRequestException('SYSTEM setting property auto_logout_minutes must be >= 0');
        }
      }
    } else if (group === 'DISCOUNTS') {
      if (value.cashierMaxDiscountPercent !== undefined) {
        if (
          !MoneyUtil.isValid(value.cashierMaxDiscountPercent) ||
          MoneyUtil.lessThan(value.cashierMaxDiscountPercent, '0') ||
          MoneyUtil.greaterThan(value.cashierMaxDiscountPercent, '100')
        ) {
          throw new BadRequestException('DISCOUNTS setting property cashierMaxDiscountPercent must be between 0 and 100');
        }
      }
      if (value.cashierMaxFixedDeduction !== undefined) {
        if (
          !MoneyUtil.isValid(value.cashierMaxFixedDeduction) ||
          MoneyUtil.lessThan(value.cashierMaxFixedDeduction, '0')
        ) {
          throw new BadRequestException('DISCOUNTS setting property cashierMaxFixedDeduction must be >= 0');
        }
      }
    }
  }

  async getSettings(tenantId: string) {
    const settings = await this.settingRepo.find({ where: { tenant_id: tenantId } });
    const result: Record<string, any> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    return result;
  }

  async updateSetting(tenantId: string, key: string, value: Record<string, any>, correlationId: string) {
    this.validateGroupSettingValue(key, value);

    let setting = await this.settingRepo.findOne({ where: { tenant_id: tenantId, key } });
    const before = setting ? { ...setting } : null;

    if (!setting) {
      setting = this.settingRepo.create({ tenant_id: tenantId, key, value, schema_version: 1 });
    } else {
      setting.value = value;
    }

    const saved = await this.settingRepo.save(setting);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'TENANT_SETTING_UPDATED',
      correlationId,
      beforeData: before,
      afterData: saved,
      details: { key },
    });

    return saved;
  }

  async getCurrencies(tenantId: string) {
    return await this.currencyRepo.find({ where: { tenant_id: tenantId }, order: { is_base: 'DESC', code: 'ASC' } });
  }

  async createCurrency(tenantId: string, data: { code: string; symbol: string; decimal_precision?: number; rounding_increment?: string; is_enabled?: boolean }, correlationId: string) {
    const code = data.code.toUpperCase();
    const existing = await this.currencyRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Currency ${code} already exists`);

    const currency = this.currencyRepo.create({
      tenant_id: tenantId,
      code,
      symbol: data.symbol,
      decimal_precision: data.decimal_precision ?? 0,
      rounding_increment: data.rounding_increment || '1.0000',
      is_enabled: data.is_enabled ?? true,
      is_base: false,
    });

    const saved = await this.currencyRepo.save(currency);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CURRENCY_CREATED',
      entityType: 'Currency',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async updateCurrency(tenantId: string, currencyId: string, data: Partial<Currency>, correlationId: string) {
    const currency = await this.currencyRepo.findOne({ where: { id: currencyId, tenant_id: tenantId } });
    if (!currency) throw new NotFoundException('Currency not found');
    const before = { ...currency };

    if (data.symbol !== undefined) currency.symbol = data.symbol;
    if (data.decimal_precision !== undefined) currency.decimal_precision = data.decimal_precision;
    if (data.rounding_increment !== undefined) currency.rounding_increment = data.rounding_increment;
    if (data.is_enabled !== undefined && !currency.is_base) currency.is_enabled = data.is_enabled;

    const saved = await this.currencyRepo.save(currency);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CURRENCY_UPDATED',
      entityType: 'Currency',
      entityId: currencyId,
      correlationId,
      beforeData: before,
      afterData: saved,
    });

    return saved;
  }

  async getPaymentMethods(tenantId: string) {
    return await this.methodRepo.find({ where: { tenant_id: tenantId }, order: { sort_order: 'ASC', code: 'ASC' } });
  }

  async createPaymentMethod(tenantId: string, data: Partial<PaymentMethod>, correlationId: string) {
    const existing = await this.methodRepo.findOne({ where: { tenant_id: tenantId, code: data.code } });
    if (existing) throw new ConflictException(`Payment method ${data.code} already exists`);

    const method = this.methodRepo.create({
      tenant_id: tenantId,
      code: data.code ? data.code.toUpperCase() : 'UNKNOWN',
      name: data.name,
      kind: data.kind || 'CASH',
      currency_code: data.currency_code || 'IRR',
      requires_reference: data.requires_reference ?? false,
      requires_device: data.requires_device ?? false,
      allows_refund: data.allows_refund ?? true,
      allows_alternative_refund: data.allows_alternative_refund ?? false,
      is_active: data.is_active ?? true,
      sort_order: data.sort_order ?? 0,
    });

    const saved = await this.methodRepo.save(method);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PAYMENT_METHOD_CREATED',
      entityType: 'PaymentMethod',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async updatePaymentMethod(tenantId: string, methodId: string, data: Partial<PaymentMethod>, correlationId: string) {
    const method = await this.methodRepo.findOne({ where: { id: methodId, tenant_id: tenantId } });
    if (!method) throw new NotFoundException('Payment method not found');
    const before = { ...method };
    Object.assign(method, data);
    const saved = await this.methodRepo.save(method);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PAYMENT_METHOD_UPDATED',
      entityType: 'PaymentMethod',
      entityId: methodId,
      correlationId,
      beforeData: before,
      afterData: saved,
    });

    return saved;
  }

  async getReasonCodes(tenantId: string) {
    return await this.reasonRepo.find({ where: { tenant_id: tenantId }, order: { code: 'ASC' } });
  }

  async createReasonCode(tenantId: string, data: { code: string; name: string; applies_to?: string[]; requires_note?: boolean }, correlationId: string) {
    const existing = await this.reasonRepo.findOne({ where: { tenant_id: tenantId, code: data.code } });
    if (existing) throw new ConflictException(`Reason code ${data.code} already exists`);

    const reason = this.reasonRepo.create({
      tenant_id: tenantId,
      code: data.code.toUpperCase(),
      name: data.name,
      applies_to: data.applies_to || ['OTHER'],
      requires_note: data.requires_note ?? false,
      is_active: true,
    });

    const saved = await this.reasonRepo.save(reason);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'REASON_CODE_CREATED',
      entityType: 'ReasonCode',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async updateReasonCode(tenantId: string, reasonId: string, data: Partial<ReasonCode>, correlationId: string) {
    const reason = await this.reasonRepo.findOne({ where: { id: reasonId, tenant_id: tenantId } });
    if (!reason) throw new NotFoundException('Reason code not found');
    const before = { ...reason };
    Object.assign(reason, data);
    const saved = await this.reasonRepo.save(reason);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'REASON_CODE_UPDATED',
      entityType: 'ReasonCode',
      entityId: reasonId,
      correlationId,
      beforeData: before,
      afterData: saved,
    });

    return saved;
  }
}
