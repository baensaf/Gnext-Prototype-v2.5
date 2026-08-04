import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('courier_settlement')
export class CourierSettlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;

  @Column({ type: 'uuid' })
  courier_id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  settlement_number: string;

  @Column({ type: 'varchar', length: 32, default: 'DRAFT' }) // DRAFT, UNDER_REVIEW, CLOSED, REVERSED
  status: string;

  @Column({ type: 'timestamptz' })
  settlement_date: Date;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  expected_cash_amount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  actual_cash_amount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  cash_discrepancy_amount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  expected_pos_amount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  actual_pos_amount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  pos_discrepancy_amount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  total_compensation_amount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  total_adjustment_amount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  net_settlement_amount: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'uuid', nullable: true })
  created_by_user_id: string;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by_user_id: string;

  @Column({ type: 'uuid', nullable: true })
  closed_by_user_id: string;

  @Column({ type: 'uuid', nullable: true })
  approval_request_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date;
}
