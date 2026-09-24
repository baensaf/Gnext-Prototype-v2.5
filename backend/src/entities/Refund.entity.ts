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
import { RefundAllocation } from './RefundAllocation.entity';

export type RefundStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERSED';

@Entity('refund')
@Unique(['tenant_id', 'refund_number'])
@Index(['tenant_id', 'order_id', 'status'])
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'varchar', length: 40 })
  refund_number: string;

  @Column({ type: 'varchar', length: 30, default: 'PENDING' })
  status: RefundStatus;

  @Column({ type: 'uuid' })
  method_id: string;

  @Column({ type: 'varchar', length: 30, default: 'CASH' })
  method_kind: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount: string;

  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency_code: string;

  @Column({ type: 'uuid', nullable: true })
  reason_code_id: string;

  @Column({ type: 'text', nullable: true })
  reason_text: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  reference: string;

  @Column({ type: 'boolean', default: false })
  is_alternative_method: boolean;

  @Column({ type: 'uuid', nullable: true })
  approval_request_id: string;

  @Column({ type: 'uuid', nullable: true })
  device_id: string;

  @Column({ type: 'uuid', nullable: true })
  settlement_account_id: string;

  @Column({ type: 'uuid', nullable: true })
  shift_id: string;

  @Column({ type: 'uuid', nullable: true })
  original_refund_id: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  failure_code: string;

  @Column({ type: 'text', nullable: true })
  failure_message: string;

  @CreateDateColumn({ type: 'timestamptz' })
  initiated_at: Date;

  /**
   * The business day the money went back on, stamped when the refund is made. Null on
   * refunds made before it was stamped; REFUND_BUSINESS_DATE_EXPR reads those the old way.
   */
  @Column({ type: 'varchar', length: 10, nullable: true })
  business_date: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  posted_at: Date;

  @VersionColumn({ default: 1 })
  version: number;

  @OneToMany(() => RefundAllocation, (alloc) => alloc.refund, { cascade: true })
  allocations: RefundAllocation[];
}
