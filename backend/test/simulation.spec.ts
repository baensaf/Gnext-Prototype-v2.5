import { Test, TestingModule } from '@nestjs/testing';
import { SimulationService } from '../src/modules/simulation/simulation.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IntegrationLog } from '../src/entities/IntegrationLog.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { Product } from '../src/entities/Product.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';

describe('SimulationService (Unit)', () => {
  let service: SimulationService;
  let logRepo: any;
  let orderRepo: any;
  let orderItemRepo: any;
  let productRepo: any;
  let branchRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    logRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    orderRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    orderItemRepo = { create: jest.fn(), save: jest.fn() };
    productRepo = { find: jest.fn(), findOne: jest.fn() };
    branchRepo = { find: jest.fn() };
    auditWriter = { write: jest.fn() };

    logRepo.create.mockImplementation((dto: any) => dto);
    logRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'log-101' }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulationService,
        { provide: getRepositoryToken(IntegrationLog), useValue: logRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(Branch), useValue: branchRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<SimulationService>(SimulationService);
  });

  it('should verify valid HMAC signature and reject invalid HMAC signature', () => {
    const rawBody = JSON.stringify({ order_code: 'SF-100' });
    const secret = 'snappfood-secret-key-123';
    const validSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    expect(service.verifyHmacSignature(rawBody, validSignature, secret)).toBe(true);
    expect(service.verifyHmacSignature(rawBody, 'invalid-signature-hash', secret)).toBe(false);
  });

  it('should reject webhook with invalid HMAC signature', async () => {
    const payload = { event_id: 'evt-101', order_code: 'SF-101' };
    const rawBody = JSON.stringify(payload);

    await expect(
      service.handleSnappfoodWebhook('t-1', rawBody, payload, 'invalid-hmac-sig'),
    ).rejects.toThrow(BadRequestException);

    expect(logRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'REJECTED' }));
  });

  it('should process new Snappfood webhook and create AGGREGATOR order', async () => {
    branchRepo.find.mockResolvedValue([{ id: 'br-1' }]);
    logRepo.findOne.mockResolvedValue(null); // No duplicate

    orderRepo.create.mockImplementation((dto: any) => dto);
    orderRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'ord-snp-1' }));
    orderItemRepo.create.mockImplementation((dto: any) => dto);
    orderItemRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'item-snp-1' }));

    const payload = {
      event_id: 'evt-200',
      order_code: 'SF-200',
      items: [{ product_name: 'Kebab', quantity: 2, price: 10.0 }],
    };
    const rawBody = JSON.stringify(payload);
    const validSig = crypto.createHmac('sha256', 'snappfood-secret-key-123').update(rawBody).digest('hex');

    const result = await service.handleSnappfoodWebhook('t-1', rawBody, payload, validSig);

    expect(result.success).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.order.order_type).toBe('AGGREGATOR');
    expect(result.order.total_amount).toBe('21.8000'); // (2*10) * 1.09
    expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'SNAPPFOOD_WEBHOOK_PROCESSED' }));
  });

  describe('an incoming Snappfood order waits for the store to accept it', () => {
    const signed = (payload: any) => {
      const rawBody = JSON.stringify(payload);
      return { rawBody, sig: crypto.createHmac('sha256', 'snappfood-secret-key-123').update(rawBody).digest('hex') };
    };

    beforeEach(() => {
      logRepo.findOne.mockResolvedValue(null);
      orderRepo.create.mockImplementation((dto: any) => dto);
      orderRepo.save.mockImplementation((dto: any) => Promise.resolve({ id: 'ord-snp-1', ...dto }));
      orderItemRepo.create.mockImplementation((dto: any) => dto);
      orderItemRepo.save.mockImplementation((dto: any) => Promise.resolve(dto));
      branchRepo.find.mockResolvedValue([
        { id: 'br-office', code: 'HQ', branch_type: 'OFFICE' },
        { id: 'br-vanak', code: 'VANAK', branch_type: 'RESTAURANT' },
        { id: 'br-tajrish', code: 'TAJRISH', branch_type: 'RESTAURANT' },
      ]);
    });

    it('lands as an aggregator order awaiting acceptance, not as a submitted POS order', async () => {
      const payload = { event_id: 'evt-300', order_code: 'SF-300' };
      const { rawBody, sig } = signed(payload);

      const result = await service.handleSnappfoodWebhook('t-1', rawBody, payload, sig);

      expect(result.order).toEqual(expect.objectContaining({
        channel: 'AGGREGATOR',
        state: 'PENDING_ACCEPTANCE',
        status: 'PENDING_ACCEPTANCE',
      }));
    });

    it('lands at the branch the webhook was addressed to, and nowhere else', async () => {
      const payload = { event_id: 'evt-301', order_code: 'SF-301', branch_code: 'TAJRISH' };
      const { rawBody, sig } = signed(payload);

      const result = await service.handleSnappfoodWebhook('t-1', rawBody, payload, sig);
      expect(result.order.branch_id).toBe('br-tajrish');

      const stray = { event_id: 'evt-302', order_code: 'SF-302', branch_code: 'NO-SUCH-BRANCH' };
      const strayBody = signed(stray);
      await expect(
        service.handleSnappfoodWebhook('t-1', strayBody.rawBody, stray, strayBody.sig),
      ).rejects.toThrow(NotFoundException);
    });

    it('without a branch, goes to a restaurant rather than the head office', async () => {
      const payload = { event_id: 'evt-303', order_code: 'SF-303' };
      const { rawBody, sig } = signed(payload);

      const result = await service.handleSnappfoodWebhook('t-1', rawBody, payload, sig);
      expect(result.order.branch_id).toBe('br-vanak');
    });

    it('stays out of the kitchen through ack and pick, and is confirmed only on accept', async () => {
      const order: any = { id: 'ord-snp-1', order_number: 'SNP-SF-304', state: 'PENDING_ACCEPTANCE', status: 'PENDING_ACCEPTANCE' };
      orderRepo.findOne.mockResolvedValue(order);

      await service.ackOrder('t-1', 'SF-304');
      await service.pickOrder('t-1', 'SF-304');
      await service.triggerSnappfoodAction('t-1', { order_id: order.id, action: 'ACK' });
      expect(order.state).toBe('PENDING_ACCEPTANCE');
      expect(order.status).toBe('PENDING_ACCEPTANCE');

      await service.acceptOrder('t-1', 'SF-304', {});
      expect(order.state).toBe('CONFIRMED');
      expect(order.status).toBe('KITCHEN_PREPARING');
    });

    // The store's own accept/reject (OrderService) moves the order itself and then tells
    // Snappfood. Telling Snappfood must not move it a second time.
    it('telling Snappfood about an acceptance leaves the local order alone', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'ord-snp-1', order_number: 'SNP-SF-305', state: 'CONFIRMED', status: 'CONFIRMED' });

      const res = await service.notifyAccepted('t-1', 'SF-305', { deliveryTime: 25 });

      expect(res.statusCode).toBe(42);
      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(logRepo.save).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'ORDER_ACCEPT' }));
    });

    it('telling Snappfood about a rejection leaves the local order alone', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'ord-snp-1', order_number: 'SNP-SF-306', state: 'REJECTED', status: 'REJECTED' });

      const res = await service.notifyRejected('t-1', 'SF-306', { reasonId: 113 });

      expect(res.statusCode).toBe(51);
      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(logRepo.save).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'ORDER_REJECT' }));
    });

    it('a store reject is a rejection, not a cancellation', async () => {
      const order: any = { id: 'ord-snp-1', order_number: 'SNP-SF-307', state: 'PENDING_ACCEPTANCE', status: 'PENDING_ACCEPTANCE' };
      orderRepo.findOne.mockResolvedValue(order);

      await service.rejectOrder('t-1', 'SF-307', { reasonId: 113 });

      expect(order.state).toBe('REJECTED');
      expect(order.status).toBe('REJECTED');
    });
  });

  it('should suppress duplicate webhook requests (exactly-once processing)', async () => {
    logRepo.findOne.mockResolvedValue({ id: 'prev-log-1', idempotency_key: 'evt-200', status: 'SUCCESS' });

    const payload = { event_id: 'evt-200', order_code: 'SF-200' };
    const rawBody = JSON.stringify(payload);
    const validSig = crypto.createHmac('sha256', 'snappfood-secret-key-123').update(rawBody).digest('hex');

    const result = await service.handleSnappfoodWebhook('t-1', rawBody, payload, validSig);

    expect(result.success).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(orderRepo.save).not.toHaveBeenCalled();
    expect(logRepo.save).toHaveBeenCalledWith(expect.objectContaining({ is_duplicate: true, event_type: 'DUPLICATE_REJECTED' }));
  });

  it('should execute Tara BNPL lifecycle commands correctly', async () => {
    const res = await service.executeTaraCommand('t-1', {
      command: 'RESERVE_CREDIT',
      customer_national_id: '0012345678',
      amount: 150.0,
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('CREDIT_RESERVED');
    expect(res.reserved_amount).toBe(150.0);
    expect(res.simulated).toBe(true);
    expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'TARA_COMMAND_RESERVE_CREDIT' }));
  });

  it('should reject webhooks with timestamp skew > 5 minutes', async () => {
    const payload = { event_id: 'evt-skewed', order_code: 'SF-SKEW' };
    const rawBody = JSON.stringify(payload);
    const secret = 'snappfood-secret-key-123';
    const oldTimestamp = (Date.now() - 10 * 60 * 1000).toString(); // 10 minutes ago
    const validSig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    await expect(
      service.handleSnappfoodWebhook('t-1', rawBody, payload, validSig, oldTimestamp),
    ).rejects.toThrow(BadRequestException);
  });

  it('should handle Tara failure scenarios deterministically', async () => {
    const res = await service.executeTaraCommand('t-1', {
      operation: 'CREATE',
      amount: 500.0,
      scenarioId: 'tara-declined',
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('FAILED');
    expect(res.error_code).toBe('INSUFFICIENT_CREDIT');
  });
});
