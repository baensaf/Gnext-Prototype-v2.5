import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, VersionColumn, DeleteDateColumn } from 'typeorm';

@Entity('payment_method')
export class PaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 30 })
  kind: string; // CASH, CREDIT, NETWORK_POS, MOBILE_POS, ONLINE, BANK_TRANSFER, TARA_PAY

  @Column({ type: 'char', length: 3, nullable: true })
  currency_code: string;

  @Column({ type: 'boolean', default: false })
  requires_reference: boolean;

  @Column({ type: 'boolean', default: false })
  requires_device: boolean;

  @Column({ type: 'boolean', default: true })
  allows_refund: boolean;

  @Column({ type: 'boolean', default: false })
  allows_alternative_refund: boolean;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'integer', default: 0 })
  sort_order: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date;

  @VersionColumn({ default: 1 })
  version: number;
}
