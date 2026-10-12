import { Injectable, NotFoundException, ConflictException, BadRequestException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Like, SelectQueryBuilder } from 'typeorm';
import { Customer } from '../../entities/Customer.entity';
import { CustomerPhone } from '../../entities/CustomerPhone.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { CustomerCreditAccount } from '../../entities/CustomerCreditAccount.entity';
import { CustomerDiscount } from '../../entities/CustomerDiscount.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { PaginationQueryDto, createPagedResponse, PagedResponse } from '../../common/dto/pagination.dto';

/** Persian (۰-۹) and Arabic (٠-٩) digits as 0-9. */
export function toWesternDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function normalizePhone(rawPhone: string): string {
  if (!rawPhone) return '';
  // A number typed on a Persian keyboard arrives in Persian (or Arabic) digits, which `\d`
  // does not match: they were stripped to nothing and the raw text kept as the number.
  const western = toWesternDigits(rawPhone);
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
export function normalizeBirthDate(raw?: string | null, field = 'birth_date'): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const datePart = trimmed.split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    throw new BadRequestException(`${field} must be a calendar date in YYYY-MM-DD form`);
  }

  const [year, month, day] = datePart.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new BadRequestException(`${field} ${datePart} is not a real date`);
  }
  // A birthday (or wedding) in the future is a typed year, not a fact.
  if (probe.getTime() > Date.now()) {
    throw new BadRequestException(`${field} cannot be in the future`);
  }

  return datePart;
}

/** A delivery address typed with the customer, or added later. The map pin is optional. */
export interface CustomerAddressInput {
  title?: string;
  address_text: string;
  postal_code?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  is_default?: boolean;
}

function normalizeAddress(data: CustomerAddressInput) {
  const addressText = String(data?.address_text || '').trim();
  if (!addressText) throw new BadRequestException({ code: 'ADDRESS_REQUIRED', message: 'An address needs its text' });
  const hasLat = data.latitude !== undefined && data.latitude !== null && data.latitude !== '';
  const hasLng = data.longitude !== undefined && data.longitude !== null && data.longitude !== '';
  if (hasLat !== hasLng) throw new BadRequestException({ code: 'ADDRESS_PIN_INVALID', message: 'A map pin needs both latitude and longitude' });
  let latitude: string | null = null;
  let longitude: string | null = null;
  if (hasLat) {
    const lat = Number(data.latitude);
    const lng = Number(data.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new BadRequestException({ code: 'ADDRESS_PIN_INVALID', message: 'The map pin is not a place on the map' });
    }
    latitude = lat.toFixed(7);
    longitude = lng.toFixed(7);
  }
  return {
    title: String(data.title || '').trim() || 'Home',
    address_text: addressText,
    postal_code: String(data.postal_code || '').trim() || null,
    latitude,
    longitude,
  };
}

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(CustomerPhone) private readonly phoneRepo: Repository<CustomerPhone>,
    @InjectRepository(CustomerAddress) private readonly addressRepo: Repository<CustomerAddress>,
    @InjectRepository(CustomerCreditAccount) private readonly accountRepo: Repository<CustomerCreditAccount>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    private readonly auditWriter: AuditWriter,
    @Optional() @InjectRepository(CustomerDiscount) private readonly familyRepo?: Repository<CustomerDiscount>,
  ) {}

  /**
   * Each customer with their two balances, kept apart: the wallet (cashback, theirs to spend)
   * and the credit account (what they owe), plus their friends-and-family rates by branch.
   */
  private async enrichCustomersWithCredit(tenantId: string, customers: Customer[]): Promise<any[]> {
    if (!customers || customers.length === 0) return [];
    const customerIds = customers.map((c) => c.id);
    const [accounts, family] = await Promise.all([
      this.accountRepo.find({ where: { tenant_id: tenantId, customer_id: In(customerIds) } }),
      this.familyRepo ? this.familyRepo.find({ where: { tenant_id: tenantId, customer_id: In(customerIds), is_active: true } }) : [],
    ]);
    return customers.map((c) => this.withAccounts(c, accounts.filter((a) => a.customer_id === c.id), family.filter((f) => f.customer_id === c.id)));
  }

  private withAccounts(c: Customer, accounts: CustomerCreditAccount[], family: CustomerDiscount[]) {
    const credit = accounts.find((a) => a.kind !== 'WALLET') || null;
    const wallet = accounts.find((a) => a.kind === 'WALLET') || null;
    return {
      ...c,
      credit_account: credit,
      wallet_account: wallet,
      wallet_balance: wallet?.current_balance || '0.0000',
      credit_limit: credit?.credit_limit || '0.0000',
      family_discounts: family.map((f) => ({ id: f.id, branch_id: f.branch_id, percent: f.discount_percentage, note: f.note })),
    };
  }

  // Customers
  async getCustomers(
    tenantId: string,
    query?: PaginationQueryDto & { search?: string; status?: string; has?: string; branchId?: string },
  ): Promise<(PagedResponse<any> & { counts?: Record<string, number> }) | any[]> {
    if (!query || (!query.page && !query.limit && !query.search && !query.status && !query.has)) {
      const qb = this.customerRepo.createQueryBuilder('c')
        .where('c.tenant_id = :tenantId', { tenantId })
        .orderBy('c.code', 'ASC');
      const items = await qb.getMany();
      return await this.enrichCustomersWithCredit(tenantId, items);
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const qb = this.customerRepo.createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId });

    const searching = this.applyCustomerSearch(qb, query.search);

    if (query.status === 'ACTIVE') {
      qb.andWhere('c.is_active = true');
    } else if (query.status === 'INACTIVE') {
      qb.andWhere('c.is_active = false');
    }

    // The list's own filters, so nobody needs a separate page to find these customers:
    // friends and family (at the given branch, or any), who owes, who has wallet money.
    if (query.has === 'FAMILY') {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM customer_discount f WHERE f.customer_id = c.id AND f.tenant_id = c.tenant_id
           AND f.is_active AND f.deleted_at IS NULL${query.branchId ? ' AND f.branch_id = :familyBranch' : ''})`,
        query.branchId ? { familyBranch: query.branchId } : {},
      );
    } else if (query.has === 'OWES') {
      qb.andWhere(`EXISTS (SELECT 1 FROM credit_account a WHERE a.customer_id = c.id AND a.tenant_id = c.tenant_id
           AND a.kind = 'CREDIT' AND a.current_balance < 0 AND a.deleted_at IS NULL)`);
    } else if (query.has === 'WALLET') {
      qb.andWhere(`EXISTS (SELECT 1 FROM credit_account a WHERE a.customer_id = c.id AND a.tenant_id = c.tenant_id
           AND a.kind = 'WALLET' AND a.current_balance > 0 AND a.deleted_at IS NULL)`);
    }

    if (!searching) qb.orderBy('c.created_at', 'DESC').addOrderBy('c.id', 'ASC');
    qb.skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();
    const enriched = await this.enrichCustomersWithCredit(tenantId, items);
    return { ...createPagedResponse(enriched, total, page, limit), counts: await this.listCounts(tenantId, query.branchId) };
  }

  /**
   * How many customers each tab of the list holds: everyone, friends and family (at the
   * branch, or any), who has wallet money, who owes. The last three read small tables.
   */
  private async listCounts(tenantId: string, branchId?: string) {
    const [row] = await this.customerRepo.query(
      `SELECT (SELECT COUNT(*) FROM customer c WHERE c.tenant_id = $1 AND c.deleted_at IS NULL)::int AS "ALL",
              (SELECT COUNT(DISTINCT f.customer_id) FROM customer_discount f
                WHERE f.tenant_id = $1 AND f.is_active AND f.deleted_at IS NULL
                  AND ($2::uuid IS NULL OR f.branch_id = $2::uuid))::int AS "FAMILY",
              (SELECT COUNT(*) FROM credit_account a WHERE a.tenant_id = $1 AND a.kind = 'WALLET'
                  AND a.current_balance > 0 AND a.deleted_at IS NULL)::int AS "WALLET",
              (SELECT COUNT(*) FROM credit_account a WHERE a.tenant_id = $1 AND a.kind = 'CREDIT'
                  AND a.current_balance < 0 AND a.deleted_at IS NULL)::int AS "OWES"`,
      [tenantId, branchId || null],
    );
    return row as Record<'ALL' | 'FAMILY' | 'WALLET' | 'OWES', number>;
  }

  /**
   * The POS customer picker: up to `limit` matches for what the cashier typed, best first, no
   * count and no credit lookups, so it stays quick with hundreds of thousands of customers.
   * Fewer than 3 characters returns nothing (the trigram indexes need 3).
   */
  async searchCustomers(tenantId: string, q: string | undefined, limit = 20) {
    const take = Math.min(50, Math.max(1, Number(limit) || 20));
    const qb = this.customerRepo.createQueryBuilder('c').where('c.tenant_id = :tenantId', { tenantId });
    if (!this.applyCustomerSearch(qb, q)) return [];
    return qb.take(take).getMany();
  }

  /**
   * Adds the search filter and ranking. Digits search the mobile (Persian or Arabic digits,
   * 0912…, +98 912… all match the same number); anything with letters searches the name
   * (Arabic ي/ك match Persian ی/ک). An exact mobile comes first, then mobiles that start
   * with what was typed, then the rest by name. Returns false when the text is too short.
   */
  private applyCustomerSearch(qb: SelectQueryBuilder<Customer>, raw: string | undefined): boolean {
    const text = toWesternDigits(String(raw || '')).trim();
    if (text.length < 3) return false;
    const like = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const nameExpr = `translate(lower(c.first_name || ' ' || c.last_name), 'يك', 'یک')`;

    const hasLetters = /\p{L}/u.test(text);
    if (!hasLetters) {
      // A mobile is stored as +98 9xx…: drop a typed 0, 98 or +98 so "0912" finds "+98912…".
      let digits = text.replace(/\D/g, '');
      if (digits.startsWith('98') && digits.length > 10) digits = digits.slice(2);
      else if (digits.startsWith('0')) digits = digits.slice(1);
      if (digits.length < 3) return false;
      qb.andWhere(`c.mobile LIKE :mobileLike ESCAPE '\\'`, { mobileLike: `%${like(digits)}%` })
        .orderBy(`CASE WHEN c.mobile = :mobileExact THEN 0 WHEN c.mobile LIKE :mobilePrefix ESCAPE '\\' THEN 1 ELSE 2 END`, 'ASC')
        .setParameters({ mobileExact: `+98${digits}`, mobilePrefix: `+98${like(digits)}%` })
        .addOrderBy('c.mobile', 'ASC');
    } else {
      const name = text.toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ');
      qb.andWhere(`${nameExpr} LIKE :nameLike ESCAPE '\\'`, { nameLike: `%${like(name)}%` })
        .orderBy(`CASE WHEN ${nameExpr} LIKE :namePrefix ESCAPE '\\' THEN 0 ELSE 1 END`, 'ASC')
        .setParameters({ namePrefix: `${like(name)}%` })
        .addOrderBy('c.first_name', 'ASC');
    }
    qb.addOrderBy('c.id', 'ASC');
    return true;
  }

  async getCustomerById(tenantId: string, id: string) {
    const customer = await this.customerRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');
    const phones = await this.phoneRepo.find({ where: { tenant_id: tenantId, customer_id: id } });
    const addresses = await this.addressRepo.find({ where: { tenant_id: tenantId, customer_id: id } });
    const accounts = await this.accountRepo.find({ where: { tenant_id: tenantId, customer_id: id } });
    const family = this.familyRepo ? await this.familyRepo.find({ where: { tenant_id: tenantId, customer_id: id, is_active: true } }) : [];
    return {
      ...this.withAccounts(customer, accounts, family),
      phones,
      addresses,
    };
  }

  async createCustomer(
    tenantId: string,
    data: {
      code?: string;
      /** The whole name in one box (the register form). Wins over first_name/last_name. */
      name?: string;
      first_name?: string;
      last_name?: string;
      mobile: string;
      email?: string;
      national_id?: string;
      birth_date?: string;
      credit_limit?: string;
      /** Delivery addresses typed with the customer; the first is the default. */
      addresses?: CustomerAddressInput[];
    },
    correlationId: string,
    actorId?: string,
  ) {
    const fullName = data.name !== undefined ? String(data.name || '').trim() : null;
    if (fullName === '') throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'A customer needs a name' });
    // Checked before anything is saved, so a bad address doesn't leave a customer behind.
    const addresses = (Array.isArray(data.addresses) ? data.addresses : []).map(normalizeAddress);

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
      first_name: fullName ?? data.first_name ?? '',
      last_name: fullName !== null ? '' : (data.last_name ?? ''),
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
      kind: 'CREDIT',
      mode: 'FINITE',
      credit_limit: MoneyUtil.format(data.credit_limit || '0'),
      current_balance: '0.0000',
    });
    await this.accountRepo.save(account);

    for (const [index, address] of addresses.entries()) {
      await this.addressRepo.save(
        this.addressRepo.create({ tenant_id: tenantId, customer_id: saved.id, ...address, is_default: index === 0, created_by: actorId || null }),
      );
    }

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
   * Edit the record's own fields. Phones, addresses and credit each have their own
   * endpoint and are not reachable from here.
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
    // The register form takes the whole name in one box, so last_name may be empty.
    if (data.last_name !== undefined) customer.last_name = (data.last_name || '').trim();
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

  // Phones
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

  // Addresses
  /**
   * A customer's addresses, each with the zones its past orders were delivered in, the latest
   * first. The register picks the first one that is its own branch's, so a returning
   * customer's zone and fee are there without the cashier choosing them again.
   */
  async getAddressesByCustomer(tenantId: string, customerId: string) {
    const addresses = await this.addressRepo.find({ where: { tenant_id: tenantId, customer_id: customerId } });
    if (addresses.length === 0) return addresses;

    const used: { address_id: string; zone_id: string }[] = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.customer_address_id', 'address_id')
      .addSelect('o.delivery_zone_id', 'zone_id')
      .where('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.customer_id = :customerId', { customerId })
      .andWhere('o.customer_address_id IS NOT NULL')
      .andWhere('o.delivery_zone_id IS NOT NULL')
      .groupBy('o.customer_address_id')
      .addGroupBy('o.delivery_zone_id')
      .orderBy('MAX(o.placed_at)', 'DESC')
      .getRawMany();

    return addresses.map((address) => ({
      ...address,
      last_zone_ids: used.filter((row) => row.address_id === address.id).map((row) => row.zone_id),
    }));
  }

  async createAddress(
    tenantId: string,
    customerId: string,
    data: CustomerAddressInput,
    actorId?: string,
  ) {
    await this.getCustomerById(tenantId, customerId);
    const address = normalizeAddress(data);

    if (data.is_default) {
      await this.addressRepo.update({ tenant_id: tenantId, customer_id: customerId }, { is_default: false });
    }

    const addr = this.addressRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      ...address,
      is_default: data.is_default ?? false,
      created_by: actorId || null,
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

