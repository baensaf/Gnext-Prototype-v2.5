import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Refund } from './Refund.entity';

@Entity('refund_allocation')
export class RefundAllocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  refund_id: string;

  // Legacy field getter & setter alias
  get refund_request_id(): string {
    return this.refund_id;
  }
  set refund_request_id(val: string) {
    this.refund_id = val;
  }

  @Column({ type: 'uuid' })
  payment_id: string;

  // Legacy field getter & setter alias
  get original_payment_id(): string {
    return this.payment_id;
  }
  set original_payment_id(val: string) {
    this.payment_id = val;
  }

  @Column({ type: 'uuid', nullable: true })
  order_item_id: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount: string;

  // Legacy field getter & setter alias
  get amount_refunded(): string {
    return this.amount;
  }
  set amount_refunded(val: string) {
    this.amount = val;
  }

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => Refund, (r) => r.allocations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'refund_id' })
  refund: Refund;
}
