import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('payment_device')
export class PaymentDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  serial_number: string;

  @Column({ type: 'varchar', length: 32, default: 'POS_TERMINAL' }) // POS_TERMINAL, MOBILE_POS, ONLINE_GATEWAY, BANK_TRANSFER
  device_type: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;

  @Column({ type: 'uuid', nullable: true })
  terminal_id: string;

  @Column({ type: 'uuid', nullable: true })
  settlement_account_id: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
