import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('refund_allocation')
export class RefundAllocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  refund_request_id: string;

  @Column({ type: 'uuid', nullable: true })
  original_payment_id: string;

  @Column({ type: 'uuid' })
  payment_method_id: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount_refunded: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
