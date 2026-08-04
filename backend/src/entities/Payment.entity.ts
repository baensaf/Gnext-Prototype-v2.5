import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('payment')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'uuid' })
  payment_method_id: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount: string;

  @Column({ type: 'varchar', length: 30, default: 'COMPLETED' })
  status: string; // PENDING, COMPLETED, FAILED, REFUNDED

  @Column({ type: 'varchar', length: 80, nullable: true })
  reference_number: string;

  @Column({ type: 'uuid', nullable: true })
  device_id: string;

  @Column({ type: 'uuid', nullable: true })
  settlement_account_id: string;

  @Column({ type: 'boolean', default: false })
  is_mobile_pos: boolean;

  @Column({ type: 'boolean', default: false })
  is_reversed: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn({ type: 'timestamptz' })
  recorded_at: Date;
}
