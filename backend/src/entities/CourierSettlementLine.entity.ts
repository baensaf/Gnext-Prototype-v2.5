import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('courier_settlement_line')
export class CourierSettlementLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  settlement_id: string;

  @Column({ type: 'uuid' })
  delivery_assignment_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'varchar', length: 64 })
  order_number: string;

  @Column({ type: 'varchar', length: 32 })
  delivery_status: string;

  @Column({ type: 'varchar', length: 32, default: 'CASH' }) // CASH, CARD, CREDIT, ONLINE
  payment_method_code: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  expected_cash: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  actual_cash: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  expected_pos: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  actual_pos: string;

  @Column({ type: 'boolean', default: true })
  receipt_verified: boolean;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  delivery_fee_amount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: '0.00' })
  commission_amount: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
