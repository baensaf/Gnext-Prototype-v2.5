import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('payment_device')
export class PaymentDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;

  @Column({ type: 'varchar', length: 40 })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 30, default: 'POS' })
  kind: string; // POS, NETWORK, MOBILE

  @Column({ type: 'varchar', length: 30, default: 'COMPANY' })
  ownership: string; // COMPANY, COURIER, THIRD_PARTY

  @Column({ type: 'uuid', nullable: true })
  settlement_account_id: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  device_identifier: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
