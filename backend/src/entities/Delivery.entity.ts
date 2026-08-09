import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, VersionColumn } from 'typeorm';

export type DeliveryState =
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'EN_ROUTE'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

@Entity('delivery')
export class Delivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'uuid', nullable: true })
  zone_id: string;

  @Column({ type: 'uuid', nullable: true })
  courier_id: string;

  @Column({ type: 'varchar', length: 30, default: 'UNASSIGNED' })
  state: DeliveryState;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  fee: string;

  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency_code: string;

  @Column({ type: 'jsonb', nullable: true })
  address_snapshot: any;

  @Column({ type: 'timestamptz', nullable: true })
  assigned_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  picked_up_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  delivered_at: Date;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  cash_expected: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  mobile_pos_expected: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  compensation_amount: string;

  @Column({ type: 'text', nullable: true })
  failure_reason: string;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
