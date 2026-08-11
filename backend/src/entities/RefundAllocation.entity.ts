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

  @Column({ type: 'uuid', nullable: true })
  refund_request_id: string;

  @Column({ type: 'uuid' })
  payment_id: string;

  @Column({ type: 'uuid', nullable: true })
  payment_method_id: string;

  @Column({ type: 'uuid', nullable: true })
  original_payment_id: string;

  @Column({ type: 'uuid', nullable: true })
  order_item_id: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  amount_refunded: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => Refund, (r) => r.allocations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'refund_id' })
  refund: Refund;
}
