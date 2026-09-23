import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, Like } from 'typeorm';
import { Customer } from '../../entities/Customer.entity';
import { CustomerPhone } from '../../entities/CustomerPhone.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { CustomerCreditAccount } from '../../entities/CustomerCreditAccount.entity';
import { CustomerTag } from '../../entities/CustomerTag.entity';
import { CustomerTagLink } from '../../entities/CustomerTagLink.entity';
import { CustomerConsent } from '../../entities/CustomerConsent.entity';
import { CustomerMerge } from '../../entities/CustomerMerge.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { CreditEntry } from '../../entities/CreditEntry.entity';
import { DiscountUsage } from '../../entities/DiscountUsage.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { PaginationQueryDto, createPagedResponse, PagedResponse } from '../../common/dto/pagination.dto';
import { TransactionUtil } from '../../common/utils/transaction.util';
import { AppDataSource } from '../../data-source';

export function normalizePhone(rawPhone: string): string {
  if (!rawPhone) return '';
  // A number typed on a Persian keyboard arrives in Persian (or Arabic) digits, which `\d`
  // does not match: they were stripped to nothing and the raw text kept as the number.
  const western = rawPhone
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  let cleaned = western.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('09') && cleaned.length === 11) {
    cleaned = '+98' + cleaned.substring(1);
  } else if (cleaned.startsWith('989') && cleaned.length === 12) {
    cleaned = '+' + cleaned;
  } else if (!cleaned.startsWith('+') && cleaned.length > 0) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

/**
 * A birthday as the calendar writes it: `YYYY-MM-DD`, no time, no zone.
 *
 * Anything carrying a time is truncated rather than converted. A date sent as midnight
 * Tehran becomes the previous day once it passes through UTC, which would move a customer's
 * birthday by one day for everyone born in the evening.
 */
export function normalizeBirthDate(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const datePart = trimmed.split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    throw new BadRequestException('birth_date must be a calendar date in YYYY-MM-DD form');
  }

  const [year, month, day] = datePart.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new BadRequestException(`birth_date ${datePart} is not a real date`);
  }
  // A birthday in the future is a typed year, not a fact.
  if (probe.getTime() > Date.now()) {
    throw new BadRequestException('birth_date cannot be in the future');
  }

  return datePart;
}

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(CustomerPhone) private readonly phoneRepo: Repository<CustomerPhone>,
    @InjectRepository(CustomerAddress) private readonly addressRepo: Repository<CustomerAddress>,
    @InjectRepository(CustomerCreditAccount) private readonly accountRepo: Repository<CustomerCreditAccount>,
    @InjectRepository(CustomerTag) private readonly tagRepo: Repository<CustomerTag>,
    @InjectRepository(CustomerTagLink) private readonly tagLinkRepo: Repository<CustomerTagLink>,
    @InjectRepository(CustomerConsent) private readonly consentRepo: Repository<CustomerConsent>,
    @InjectRepository(CustomerMerge) private readonly mergeRepo: Repository<CustomerMerge>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
  ) {}

  private async enrichCustomersWithCredit(tenantId: string, customers: Customer[]): Promise<any[]> {
    if (!customers || customers.length === 0) return [];
    const customerIds = customers.map((c) => c.id);
    const accounts = await this.accountRepo.find({
      where: { tenant_id: tenantId, customer_id: In(customerIds) },
    });
    const accMap = new Map(accounts.map((a) => [a.customer_id, a]));
    return customers.map((c) => {
      const acc = accMap.get(c.id);
      return {
        ...c,
        credit_account: acc || null,
        wallet_balance: acc?.current_balance || '0.0000',
        credit_limit: acc?.credit_limit || '0.0000',
      };
    });
  }

  // Customers
  async getCustomers(
    tenantId: string,
    query?: PaginationQueryDto & { search?: string; status?: string; tagId?: string },
  ): Promise<PagedResponse<any> | any[]> {
    if (!query || (!query.page && !query.limit && !query.search && !query.status && !query.tagId)) {
      const qb = this.customerRepo.createQueryBuilder('c')
        .where('c.tenant_id = :tenantId', { tenantId })
        .orderBy('c.code', 'ASC');
      const items = await qb.getMany();
      return await this.enrichCustomersWithCredit(tenantId, items);
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const qb = this.customerRepo.createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId });

    if (query.search) {
      const norm = normalizePhone(query.search);
      qb.andWhere(
        '(LOWER(c.code) LIKE :search OR LOWER(c.first_name) LIKE :search OR LOWER(c.last_name) LIKE :search OR c.mobile LIKE :search OR c.mobile LIKE :normPhone)',
        { search: `%${query.search.toLowerCase()}%`, normPhone: `%${norm}%` },
      );
    }

    if (query.status === 'ACTIVE') {
      qb.andWhere('c.is_active = true');
    } else if (query.status === 'INACTIVE') {
      qb.andWhere('c.is_active = false');
    }

    qb.orderBy('c.code', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    const enriched = await this.enrichCustomersWithCredit(tenantId, items);
    return createPagedResponse(enriched, total, page, limit);
  }

  async getCustomerById(tenantId: string, id: string) {
    const customer = await this.customerRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');
    const phones = await this.phoneRepo.find({ where: { tenant_id: tenantId, customer_id: id } });
    const addresses = await this.addressRepo.find({ where: { tenant_id: tenantId, customer_id: id } });
    const tagLinks = await this.tagLinkRepo.find({ where: { tenant_id: tenantId, customer_id: id } });
    const consents = await this.consentRepo.find({ where: { tenant_id: tenantId, customer_id: id } });
    const creditAccount = await this.accountRepo.findOne({ where: { tenant_id: tenantId, customer_id: id } });
    return {
      ...customer,
      phones,
      addresses,
      tags: tagLinks,
      consents,
      credit_account: creditAccount || null,
      wallet_balance: creditAccount?.current_balance || '0.0000',
      credit_limit: creditAccount?.credit_limit || '0.0000',
    };
  }

  async createCustomer(
    tenantId: string,
    data: {
      code?: string;
      first_name: string;
      last_name: string;
      mobile: string;
      email?: string;
      national_id?: string;
      birth_date?: string;
      credit_limit?: string;
    },
    correlationId: string,
    actorId?: string,
  ) {
    const normMobile = normalizePhone(data.mobile);
    const rawMobile = data.mobile ? data.mobile.trim() : '';
    const rawCode = data.code ? data.code.trim() : '';

    const code = (rawCode || normMobile || rawMobile).toUpperCase();
    if (!code) {
      throw new BadRequestException('Mobile phone number is required to register customer');
    }
    // "abc" normalised to nothing, so the text itself became the customer's number and code.
    if (rawMobile && normMobile.replace(/\D/g, '').length < 8) {
      throw new BadRequestException({ code: 'INVALID_MOBILE', message: `"${rawMobile}" is not a phone number` });
    }

    const existing = await this.customerRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Customer code ${code} already exists`);

    // The code only caught a repeat typed the same way. 0912…, +98 912… and a record kept
    // under a CUST- code are one person, and a second record splits their history and credit.
    const last10 = normMobile.replace(/\D/g, '').slice(-10);
    if (last10.length === 10) {
      const sameNumber = (
        (await this.customerRepo.find({ where: { tenant_id: tenantId, is_active: true, mobile: Like(`%${last10}`) } })) || []
      ).find((c) => normalizePhone(c.mobile) === normMobile);
      if (sameNumber) {
        throw new ConflictException({
          code: 'CUSTOMER_MOBILE_EXISTS',
          message: `${sameNumber.first_name} ${sameNumber.last_name} (${sameNumber.code}) already has this mobile number`.replace(/\s+/g, ' '),
          customerId: sameNumber.id,
        });
      }
    }

    const customer = this.customerRepo.create({
      tenant_id: tenantId,
      code,
      first_name: data.first_name,
      last_name: data.last_name,
      mobile: normMobile || rawMobile,
      email: data.email || null,
      national_id: data.national_id || null,
      birth_date: normalizeBirthDate(data.birth_date),
      is_active: true,
    });

    const saved = await this.customerRepo.save(customer);

    // Save primary phone record
    const phoneRecord = this.phoneRepo.create({
      tenant_id: tenantId,
      customer_id: saved.id,
      phone_number: data.mobile,
      normalized_phone: normMobile,
      label: 'PRIMARY_MOBILE',
      is_primary: true,
      is_verified: true,
    });
    await this.phoneRepo.save(phoneRecord);

    // Automatically create credit account
    const account = this.accountRepo.create({
      tenant_id: tenantId,
      customer_id: saved.id,
      currency_code: 'IRR',
      mode: 'FINITE',
      status: 'ACTIVE',
      credit_limit: MoneyUtil.format(data.credit_limit || '0'),
      current_balance: '0.0000',
      is_blocked: false,
    });
    await this.accountRepo.save(account);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'CUSTOMER_CREATED',
      entityType: 'Customer',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  /**
   * Edit the record's own fields. Phones, addresses, tags and credit each have their own
   * endpoint and are not reachable from here.
   *
   * `is_blocked` is not settable here either: refusing to serve somebody needs a reason and
   * ought to read as one deliberate act in the audit log, not as an edit that happened to
   * flip a flag. See `setBlocked`.
   */
  async updateCustomer(
    tenantId: string,
    id: string,
    data: {
      first_name?: string;
      last_name?: string;
      email?: string | null;
      national_id?: string | null;
      birth_date?: string | null;
      is_active?: boolean;
    },
    correlationId?: string,
    actorId?: string,
  ) {
    const customer = await this.customerRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');
    const before = { ...customer };

    if (data.first_name !== undefined) {
      const name = data.first_name.trim();
      if (!name) throw new BadRequestException('first_name cannot be empty');
      customer.first_name = name;
    }
    if (data.last_name !== undefined) {
      const name = data.last_name.trim();
      if (!name) throw new BadRequestException('last_name cannot be empty');
      customer.last_name = name;
    }
    if (data.email !== undefined) customer.email = data.email?.trim() || null;
    if (data.national_id !== undefined) customer.national_id = data.national_id?.trim() || null;
    if (data.birth_date !== undefined) customer.birth_date = normalizeBirthDate(data.birth_date);
    if (data.is_active !== undefined) customer.is_active = Boolean(data.is_active);
    customer.updated_by = actorId || null;

    const saved = await this.customerRepo.save(customer);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'CUSTOMER_UPDATED',
      entityType: 'Customer',
      entityId: saved.id,
      correlationId,
      beforeData: before,
      afterData: saved,
    });

    return saved;
  }

  /**
   * Refuse, or resume, serving somebody.
   *
   * Kept apart from `updateCustomer` because this is the one customer field with an
   * operational consequence — a blocked customer cannot be put on a new order by any
   * channel — and because a block is only worth anything if the reason travels with it.
   * Who did it and why are on the row, not only in the audit log, so the cashier who is
   * turning an order away can be told what to say.
   */
  async setBlocked(
    tenantId: string,
    id: string,
    blocked: boolean,
    reason?: string,
    correlationId?: string,
    actorId?: string,
  ) {
    const customer = await this.customerRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const trimmedReason = (reason || '').trim();
    if (blocked && !trimmedReason) {
      throw new BadRequestException('A reason is required to block a customer');
    }

    const before = { ...customer };
    customer.is_blocked = blocked;
    customer.blocked_reason = blocked ? trimmedReason : null;
    customer.blocked_at = blocked ? new Date() : null;
    customer.blocked_by = blocked ? actorId || null : null;
    customer.updated_by = actorId || null;

    const saved = await this.customerRepo.save(customer);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: blocked ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED',
      entityType: 'Customer',
      entityId: saved.id,
      correlationId,
      beforeData: before,
      afterData: saved,
      details: { reason: trimmedReason || null },
    });

    return saved;
  }

  // Deduplication & Candidates
  async getDuplicateCandidates(tenantId: string) {
    const customers = await this.customerRepo.find({ where: { tenant_id: tenantId, is_active: true } });
    const candidates = [];

    const phoneMap = new Map<string, Customer[]>();
    for (const c of customers) {
      const norm = normalizePhone(c.mobile);
      if (!norm) continue;
      if (!phoneMap.has(norm)) phoneMap.set(norm, []);
      phoneMap.get(norm)!.push(c);
    }

    for (const [phone, group] of phoneMap.entries()) {
      if (group.length > 1) {
        // Keep the record the customer has had longest — it carries the history, the credit
        // account and the loyalty balance — and fold the newer copies into it.
        group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        for (let i = 0; i < group.length - 1; i++) {
          for (let j = i + 1; j < group.length; j++) {
            candidates.push({
              target_customer_id: group[i].id,
              target_customer_name: `${group[i].first_name} ${group[i].last_name}`,
              source_customer_id: group[j].id,
              source_customer_name: `${group[j].first_name} ${group[j].last_name}`,
              match_score: 100,
              match_reason: `Exact normalized mobile match (${phone})`,
            });
          }
        }
      }
    }

    return candidates;
  }

  // Transactional Merge
  async mergeCustomers(
    tenantId: string,
    params: { target_customer_id: string; source_customer_id: string; field_resolutions?: Record<string, string> },
    correlationId: string,
  ) {
    const ds = AppDataSource.isInitialized ? AppDataSource : this.dataSource;

    const result = await TransactionUtil.runInTransaction(ds, async (manager) => {
      const custRepoTx = manager.getRepository(Customer);
      const phoneRepoTx = manager.getRepository(CustomerPhone);
      const addrRepoTx = manager.getRepository(CustomerAddress);
      const accRepoTx = manager.getRepository(CustomerCreditAccount);
      const tagLinkRepoTx = manager.getRepository(CustomerTagLink);
      const consentRepoTx = manager.getRepository(CustomerConsent);
      const orderRepoTx = manager.getRepository(OrderHeader);
      const mergeRepoTx = manager.getRepository(CustomerMerge);

      const target = await custRepoTx.findOne({ where: { id: params.target_customer_id, tenant_id: tenantId } });
      const source = await custRepoTx.findOne({ where: { id: params.source_customer_id, tenant_id: tenantId } });

      if (!target || !source) {
        throw new NotFoundException('Target or Source customer not found for merge');
      }

      // Relink orders
      await orderRepoTx.update({ tenant_id: tenantId, customer_id: source.id }, { customer_id: target.id });

      // Fold the credit accounts together. A customer holds one account per currency, and
      // every customer is given one on sign-up, so relinking the source's account onto the
      // target broke that rule and the whole merge failed. Its ledger moves across instead,
      // with its balance, and the emptied account is closed.
      const sourceAccounts = await accRepoTx.find({ where: { tenant_id: tenantId, customer_id: source.id } });
      for (const sourceAccount of sourceAccounts) {
        const targetAccount = await accRepoTx.findOne({
          where: { tenant_id: tenantId, customer_id: target.id, currency_code: sourceAccount.currency_code },
        });
        if (!targetAccount) {
          await accRepoTx.update({ id: sourceAccount.id }, { customer_id: target.id });
          continue;
        }
        await manager.getRepository(CreditEntry).update({ account_id: sourceAccount.id }, { account_id: targetAccount.id });
        targetAccount.current_balance = MoneyUtil.add(targetAccount.current_balance, sourceAccount.current_balance);
        if (MoneyUtil.greaterThan(sourceAccount.credit_limit, targetAccount.credit_limit)) {
          targetAccount.credit_limit = sourceAccount.credit_limit;
        }
        await accRepoTx.save(targetAccount);
        sourceAccount.current_balance = MoneyUtil.format('0');
        sourceAccount.status = 'CLOSED';
        await accRepoTx.save(sourceAccount);
      }

      // Coupon redemptions count per customer, so they follow the person.
      await manager.getRepository(DiscountUsage).update({ tenant_id: tenantId, customer_id: source.id }, { customer_id: target.id });

      // Relink addresses & phones
      await addrRepoTx.update({ tenant_id: tenantId, customer_id: source.id }, { customer_id: target.id });
      await phoneRepoTx.update({ tenant_id: tenantId, customer_id: source.id }, { customer_id: target.id });
      await tagLinkRepoTx.update({ tenant_id: tenantId, customer_id: source.id }, { customer_id: target.id });
      await consentRepoTx.update({ tenant_id: tenantId, customer_id: source.id }, { customer_id: target.id });

      // Soft remove source customer
      source.is_active = false;
      await custRepoTx.softRemove(source);

      // Create merge audit record
      const mergeRecord = mergeRepoTx.create({
        tenant_id: tenantId,
        target_customer_id: target.id,
        source_customer_id: source.id,
        field_resolutions_json: params.field_resolutions || {},
        merged_by: null,
      });

      return await mergeRepoTx.save(mergeRecord);
    });

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CUSTOMER_MERGED',
      correlationId,
      details: { targetCustomerId: params.target_customer_id, sourceCustomerId: params.source_customer_id, mergeId: result.id },
    });

    return { success: true, merge_id: result.id };
  }

  // Phones, Tags, Consents
  async addPhone(tenantId: string, customerId: string, phoneNumber: string, label: string = 'MOBILE', isPrimary: boolean = false, actorId?: string) {
    const norm = normalizePhone(phoneNumber);
    if (isPrimary) {
      await this.phoneRepo.update({ tenant_id: tenantId, customer_id: customerId }, { is_primary: false });
      await this.customerRepo.update({ tenant_id: tenantId, id: customerId }, { mobile: norm });
    }

    const phone = this.phoneRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      phone_number: phoneNumber,
      normalized_phone: norm,
      label,
      is_primary: isPrimary,
      is_verified: true,
    });
    const saved = await this.phoneRepo.save(phone);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'CUSTOMER_PHONE_ADDED',
      entityType: 'Customer',
      entityId: customerId,
      afterData: saved,
    });
    return saved;
  }

  async addConsent(tenantId: string, customerId: string, consentType: string, granted: boolean = true, actorId?: string) {
    const consent = this.consentRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      consent_type: consentType,
      granted,
    });
    const saved = await this.consentRepo.save(consent);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'CUSTOMER_CONSENT_RECORDED',
      entityType: 'Customer',
      entityId: customerId,
      afterData: saved,
    });
    return saved;
  }

  // Addresses
  async getAddressesByCustomer(tenantId: string, customerId: string) {
    return await this.addressRepo.find({ where: { tenant_id: tenantId, customer_id: customerId } });
  }

  async createAddress(
    tenantId: string,
    customerId: string,
    data: { title: string; address_text: string; postal_code?: string; is_default?: boolean },
    actorId?: string,
  ) {
    await this.getCustomerById(tenantId, customerId);

    if (data.is_default) {
      await this.addressRepo.update({ tenant_id: tenantId, customer_id: customerId }, { is_default: false });
    }

    const addr = this.addressRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      title: data.title,
      address_text: data.address_text,
      postal_code: data.postal_code || null,
      is_default: data.is_default ?? false,
    });

    const saved = await this.addressRepo.save(addr);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'CUSTOMER_ADDRESS_ADDED',
      entityType: 'Customer',
      entityId: customerId,
      afterData: saved,
    });
    return saved;
  }
}

