import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  VersionColumn,
  Index,
  Unique,
  OneToMany,
} from 'typeorm';
import { PaymentAllocation } from './PaymentAllocation.entity';
import { PaymentAttempt } from './PaymentAttempt.entity';

export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERSED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

@Entity('payment')
@Unique(['tenant_id', 'payment_number'])
@Index(['tenant_id', 'order_id', 'status'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'varchar', length: 40 })
  payment_number: string;

  @Column({ type: 'uuid' })
  method_id: string;

  // Legacy field getter & setter alias
  get payment_method_id(): string {
    return this.method_id;
  }
  set payment_method_id(val: string) {
    this.method_id = val;
  }

  @Column({ type: 'varchar', length: 30, default: 'CASH' })
  method_kind: string; // CASH, CARD, POS, MOBILE_POS, CUSTOMER_CREDIT, BANK_TRANSFER, ONLINE

  @Column({ type: 'varchar', length: 30, default: 'PENDING' })
  status: PaymentStatus;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount: string;

  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency_code: string;

  @Column({ type: 'uuid', nullable: true })
  device_id: string;

  @Column({ type: 'uuid', nullable: true })
  settlement_account_id: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  reference: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  receipt_number: string;

  @Column({ type: 'uuid', nullable: true })
  shift_id: string;

  @Column({ type: 'varchar', length: 10 })
  business_date: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  idempotency_key: string;

  @Column({ type: 'uuid', nullable: true })
  original_payment_id: string;

  @Column({ type: 'uuid', nullable: true })
  correction_group_id: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  failure_code: string;

  @Column({ type: 'text', nullable: true })
  failure_message: string;

  @CreateDateColumn({ type: 'timestamptz' })
  initiated_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  posted_at: Date;

  // Legacy is_reversed getter
  get is_reversed(): boolean {
    return this.status === 'REVERSED';
  }

  @VersionColumn({ default: 1 })
  version: number;

  @OneToMany(() => PaymentAllocation, (alloc) => alloc.payment, { cascade: true })
  allocations: PaymentAllocation[];

  @OneToMany(() => PaymentAttempt, (att) => att.payment, { cascade: true })
  attempts: PaymentAttempt[];
}
