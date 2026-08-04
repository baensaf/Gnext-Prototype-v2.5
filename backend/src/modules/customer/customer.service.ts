import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerGroup } from '../../entities/CustomerGroup.entity';
import { Customer } from '../../entities/Customer.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { CustomerCreditAccount } from '../../entities/CustomerCreditAccount.entity';
import { CustomerCreditTransaction } from '../../entities/CustomerCreditTransaction.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(CustomerGroup) private readonly groupRepo: Repository<CustomerGroup>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(CustomerAddress) private readonly addressRepo: Repository<CustomerAddress>,
    @InjectRepository(CustomerCreditAccount) private readonly accountRepo: Repository<CustomerCreditAccount>,
    @InjectRepository(CustomerCreditTransaction) private readonly txRepo: Repository<CustomerCreditTransaction>,
    private readonly auditWriter: AuditWriter,
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

  // Customers
  async getCustomers(tenantId: string, search?: string) {
    const qb = this.customerRepo.createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .orderBy('c.code', 'ASC');

    if (search) {
      qb.andWhere('(c.code ILIKE :search OR c.first_name ILIKE :search OR c.last_name ILIKE :search OR c.mobile ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    return await qb.getMany();
  }

  async getCustomerById(tenantId: string, id: string) {
    const customer = await this.customerRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async createCustomer(
    tenantId: string,
    data: {
      code: string;
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
    const code = data.code.toUpperCase();
    const existing = await this.customerRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Customer code ${code} already exists`);

    const customer = this.customerRepo.create({
      tenant_id: tenantId,
      code,
      first_name: data.first_name,
      last_name: data.last_name,
      mobile: data.mobile,
      email: data.email || null,
      customer_group_id: data.customer_group_id || null,
      national_id: data.national_id || null,
      is_active: true,
    });

    const saved = await this.customerRepo.save(customer);

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

  // Credit Account & Ledger Transactions
  async getCreditAccount(tenantId: string, customerId: string) {
    let account = await this.accountRepo.findOne({ where: { tenant_id: tenantId, customer_id: customerId } });
    if (!account) {
      account = this.accountRepo.create({
        tenant_id: tenantId,
        customer_id: customerId,
        credit_limit: '0.0000',
        current_balance: '0.0000',
        is_blocked: false,
      });
      account = await this.accountRepo.save(account);
    }

    const transactions = await this.txRepo.find({
      where: { tenant_id: tenantId, account_id: account.id },
      order: { recorded_at: 'DESC' },
    });

    return { account, transactions };
  }

  async postCreditTransaction(
    tenantId: string,
    customerId: string,
    data: { transaction_type: string; amount: string; note?: string; reference_id?: string },
    correlationId: string,
  ) {
    const { account } = await this.getCreditAccount(tenantId, customerId);

    if (account.is_blocked) {
      throw new BadRequestException('Customer credit account is blocked');
    }

    const amountFormatted = MoneyUtil.format(data.amount);
    let newBalance = account.current_balance;

    if (data.transaction_type === 'CHARGE' || data.transaction_type === 'SETTLEMENT') {
      newBalance = MoneyUtil.add(account.current_balance, amountFormatted);
    } else if (data.transaction_type === 'DEBIT') {
      newBalance = MoneyUtil.subtract(account.current_balance, amountFormatted);
    } else if (data.transaction_type === 'ADJUSTMENT') {
      newBalance = amountFormatted;
    } else {
      throw new BadRequestException(`Invalid transaction type ${data.transaction_type}`);
    }

    account.current_balance = newBalance;
    await this.accountRepo.save(account);

    const tx = this.txRepo.create({
      tenant_id: tenantId,
      account_id: account.id,
      transaction_type: data.transaction_type,
      amount: amountFormatted,
      note: data.note || null,
      reference_id: data.reference_id || null,
    });

    const savedTx = await this.txRepo.save(tx);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CREDIT_TRANSACTION_POSTED',
      entityType: 'CustomerCreditTransaction',
      entityId: savedTx.id,
      correlationId,
      afterData: { accountId: account.id, newBalance, transaction: savedTx },
    });

    return { account, transaction: savedTx };
  }

  async postRepayment(
    tenantId: string,
    customerId: string,
    data: { amount: string; note?: string; reference_id?: string },
    correlationId: string,
  ) {
    return await this.postCreditTransaction(
      tenantId,
      customerId,
      {
        transaction_type: 'CHARGE',
        amount: data.amount,
        note: data.note || 'Credit account repayment top-up',
        reference_id: data.reference_id,
      },
      correlationId,
    );
  }

  async postAdjustment(
    tenantId: string,
    customerId: string,
    data: { amount: string; note?: string; reference_id?: string },
    correlationId: string,
  ) {
    return await this.postCreditTransaction(
      tenantId,
      customerId,
      {
        transaction_type: 'ADJUSTMENT',
        amount: data.amount,
        note: data.note || 'Credit balance manual adjustment',
        reference_id: data.reference_id,
      },
      correlationId,
    );
  }

  async getCreditStatement(tenantId: string, customerId: string) {
    const customer = await this.getCustomerById(tenantId, customerId);
    const { account, transactions } = await this.getCreditAccount(tenantId, customerId);

    const availableCredit = MoneyUtil.add(account.credit_limit, account.current_balance);

    return {
      customer: {
        id: customer.id,
        code: customer.code,
        name: `${customer.first_name} ${customer.last_name}`,
        mobile: customer.mobile,
      },
      credit_account: {
        ...account,
        available_credit: availableCredit,
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        transaction_type: t.transaction_type,
        amount: t.amount,
        note: t.note,
        reference_id: t.reference_id,
        recorded_at: t.recorded_at,
      })),
    };
  }

  async getCreditAgingReport(tenantId: string) {
    const accounts = await this.accountRepo.find({ where: { tenant_id: tenantId } });
    const customers = await this.customerRepo.find({ where: { tenant_id: tenantId } });
    const custMap = new Map(customers.map((c) => [c.id, c]));

    const agingBuckets = await Promise.all(
      accounts.map(async (acc) => {
        const cust = custMap.get(acc.customer_id);
        const txs = await this.txRepo.find({ where: { tenant_id: tenantId, account_id: acc.id } });

        let current = '0.0000'; // 0-30 days
        let days30 = '0.0000';  // 31-60 days
        let days60 = '0.0000';  // 61-90 days
        let days90Plus = '0.0000'; // 90+ days

        const now = new Date().getTime();

        txs.forEach((t) => {
          if (t.transaction_type === 'DEBIT') {
            const ageDays = (now - new Date(t.recorded_at).getTime()) / (1000 * 3600 * 24);
            if (ageDays <= 30) {
              current = MoneyUtil.add(current, t.amount);
            } else if (ageDays <= 60) {
              days30 = MoneyUtil.add(days30, t.amount);
            } else if (ageDays <= 90) {
              days60 = MoneyUtil.add(days60, t.amount);
            } else {
              days90Plus = MoneyUtil.add(days90Plus, t.amount);
            }
          }
        });

        const availableCredit = MoneyUtil.add(acc.credit_limit, acc.current_balance);

        return {
          customer_id: acc.customer_id,
          customer_name: cust ? `${cust.first_name} ${cust.last_name}` : 'Unknown Customer',
          customer_code: cust ? cust.code : 'UNKNOWN',
          credit_limit: acc.credit_limit,
          current_balance: acc.current_balance,
          available_credit: availableCredit,
          aging: {
            current_0_30: current,
            days_31_60: days30,
            days_61_90: days60,
            days_90_plus: days90Plus,
          },
        };
      }),
    );

    return agingBuckets;
  }
}
