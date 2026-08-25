import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { CustomerGroup } from '../../entities/CustomerGroup.entity';
import { Customer } from '../../entities/Customer.entity';
import { CustomerPhone } from '../../entities/CustomerPhone.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { CustomerCreditAccount } from '../../entities/CustomerCreditAccount.entity';
import { CustomerTag } from '../../entities/CustomerTag.entity';
import { CustomerTagLink } from '../../entities/CustomerTagLink.entity';
import { CustomerConsent } from '../../entities/CustomerConsent.entity';
import { CustomerMerge } from '../../entities/CustomerMerge.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { PaginationQueryDto, createPagedResponse, PagedResponse } from '../../common/dto/pagination.dto';
import { TransactionUtil } from '../../common/utils/transaction.util';
import { AppDataSource } from '../../data-source';

export function normalizePhone(rawPhone: string): string {
  if (!rawPhone) return '';
  let cleaned = rawPhone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('09') && cleaned.length === 11) {
    cleaned = '+98' + cleaned.substring(1);
  } else if (cleaned.startsWith('989') && cleaned.length === 12) {
    cleaned = '+' + cleaned;
  } else if (!cleaned.startsWith('+') && cleaned.length > 0) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(CustomerGroup) private readonly groupRepo: Repository<CustomerGroup>,
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

  // Customer Groups
  async getCustomerGroups(tenantId: string) {
    return await this.groupRepo.find({ where: { tenant_id: tenantId }, order: { code: 'ASC' } });
  }

  async createCustomerGroup(
    tenantId: string,
    data: { code: string; name: string; discount_id?: string; price_group_id?: string },
    correlationId: string,
  ) {
    const code = data.code.toUpperCase();
    const existing = await this.groupRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Customer Group code ${code} already exists`);

    const group = this.groupRepo.create({
      tenant_id: tenantId,
      code,
      name: data.name,
      discount_id: data.discount_id || null,
      price_group_id: data.price_group_id || null,
      is_active: true,
    });

    const saved = await this.groupRepo.save(group);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CUSTOMER_GROUP_CREATED',
      entityType: 'CustomerGroup',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

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
      customer_group_id?: string;
      national_id?: string;
      credit_limit?: string;
    },
    correlationId: string,
  ) {
    const normMobile = normalizePhone(data.mobile);
    const rawMobile = data.mobile ? data.mobile.trim() : '';
    const rawCode = data.code ? data.code.trim() : '';

    const code = (rawCode || normMobile || rawMobile).toUpperCase();
    if (!code) {
      throw new BadRequestException('Mobile phone number is required to register customer');
    }

    const existing = await this.customerRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Customer code ${code} already exists`);

    const customer = this.customerRepo.create({
      tenant_id: tenantId,
      code,
      first_name: data.first_name,
      last_name: data.last_name,
      mobile: normMobile || rawMobile,
      email: data.email || null,
      customer_group_id: data.customer_group_id || null,
      national_id: data.national_id || null,
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
      credit_limit: MoneyUtil.format(data.credit_limit || '0'),
      current_balance: '0.0000',
      is_blocked: false,
    });
    await this.accountRepo.save(account);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CUSTOMER_CREATED',
      entityType: 'Customer',
      entityId: saved.id,
      correlationId,
      afterData: saved,
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

      // Relink credit accounts
      await accRepoTx.update({ tenant_id: tenantId, customer_id: source.id }, { customer_id: target.id });

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
  async addPhone(tenantId: string, customerId: string, phoneNumber: string, label: string = 'MOBILE', isPrimary: boolean = false) {
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
    return await this.phoneRepo.save(phone);
  }

  async addConsent(tenantId: string, customerId: string, consentType: string, granted: boolean = true) {
    const consent = this.consentRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      consent_type: consentType,
      granted,
    });
    return await this.consentRepo.save(consent);
  }

  // Addresses
  async getAddressesByCustomer(tenantId: string, customerId: string) {
    return await this.addressRepo.find({ where: { tenant_id: tenantId, customer_id: customerId } });
  }

  async createAddress(
    tenantId: string,
    customerId: string,
    data: { title: string; address_text: string; postal_code?: string; is_default?: boolean },
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

    return await this.addressRepo.save(addr);
  }
}

