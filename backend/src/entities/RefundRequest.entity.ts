import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('refund_request')
export class RefundRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'uuid' })
  requester_user_id: string;

  @Column({ type: 'varchar', length: 32, default: 'APPROVED' }) // PENDING, APPROVED, REJECTED, EXPIRED, CANCELLED
  status: string;

  @Column({ type: 'varchar', length: 32, default: 'FULL' }) // FULL, PARTIAL, ITEM_LEVEL
  refund_type: string;

  @Column({ type: 'uuid', nullable: true })
  reason_code_id: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  total_refund_amount: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
