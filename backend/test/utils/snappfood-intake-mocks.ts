import { getRepositoryToken } from '@nestjs/typeorm';
import { Payment } from '../../src/entities/Payment.entity';
import { PaymentAllocation } from '../../src/entities/PaymentAllocation.entity';
import { PaymentMethod } from '../../src/entities/PaymentMethod.entity';
import { CustomerPhone } from '../../src/entities/CustomerPhone.entity';
import { CustomerAddress } from '../../src/entities/CustomerAddress.entity';
import { CustomerService } from '../../src/modules/customer/customer.service';
import { AgentSyncOrder } from '../../src/entities/AgentSyncOrder.entity';
import { OrderStateEvent } from '../../src/entities/OrderStateEvent.entity';

/**
 * The payment and customer stores a Snappfood order lands in, for tests that build
 * SimulationService by hand. Payments and addresses are kept in memory so a test can read
 * back what the intake recorded.
 */
export function snappfoodIntakeMocks() {
  const payments: any[] = [];
  const addresses: any[] = [];
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]) => row[key] === value);

  const paymentRepo = {
    find: jest.fn(({ where }: any) => Promise.resolve(payments.filter((p) => matches(p, where)))),
    count: jest.fn(({ where }: any) => Promise.resolve(payments.filter((p) => matches(p, where)).length)),
    create: jest.fn((dto: any) => dto),
    save: jest.fn((dto: any) => {
      if (!dto.id) {
        dto.id = `pay-${payments.length + 1}`;
        payments.push(dto);
      }
      return Promise.resolve(dto);
    }),
  };
  const allocationRepo = { create: jest.fn((dto: any) => dto), save: jest.fn((dto: any) => Promise.resolve(dto)) };
  const paymentMethodRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'pm-online', kind: 'ONLINE', is_active: true }),
  };
  const customerPhoneRepo = { findOne: jest.fn().mockResolvedValue(null) };
  const customerAddressRepo = {
    find: jest.fn(({ where }: any) => Promise.resolve(addresses.filter((a) => matches(a, where)))),
    create: jest.fn((dto: any) => dto),
    save: jest.fn((dto: any) => {
      const saved = { id: `addr-${addresses.length + 1}`, ...dto };
      addresses.push(saved);
      return Promise.resolve(saved);
    }),
  };
  const customerService = { createCustomer: jest.fn().mockResolvedValue({ id: 'cust-new' }) };

  return {
    payments,
    addresses,
    paymentRepo,
    paymentMethodRepo,
    customerPhoneRepo,
    customerService,
    providers: [
      { provide: getRepositoryToken(Payment), useValue: paymentRepo },
      { provide: getRepositoryToken(PaymentAllocation), useValue: allocationRepo },
      { provide: getRepositoryToken(PaymentMethod), useValue: paymentMethodRepo },
      { provide: getRepositoryToken(CustomerPhone), useValue: customerPhoneRepo },
      { provide: getRepositoryToken(CustomerAddress), useValue: customerAddressRepo },
      { provide: CustomerService, useValue: customerService },
      // Only a till-typed order (§17.7) reaches these; the intake tests never make one.
      { provide: getRepositoryToken(AgentSyncOrder), useValue: { findOne: jest.fn().mockResolvedValue(null), save: jest.fn() } },
      { provide: getRepositoryToken(OrderStateEvent), useValue: { create: jest.fn((dto: any) => dto), save: jest.fn() } },
    ],
  };
}
