import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, VersionColumn, OneToMany } from 'typeorm';
import { OrderItem } from './OrderItem.entity';
import { OrderAdjustment } from './OrderAdjustment.entity';
import { OrderNote } from './OrderNote.entity';
import { OrderStateEvent } from './OrderStateEvent.entity';

export type OrderState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'COMPLETED'
  | 'CANCELLED';

@Entity('order_header')
export class OrderHeader {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'uuid', nullable: true })
  terminal_id: string;

  @Column({ type: 'uuid', nullable: true })
  shift_id: string;

  @Column({ type: 'varchar', length: 32 })
  order_number: string;

  @Column({ type: 'varchar', length: 30, default: 'DINE_IN' })
  order_type: string; // DINE_IN, TAKEAWAY, DELIVERY, AGGREGATOR

  @Column({ type: 'varchar', length: 32, default: 'POS' })
  channel: string; // POS, KIOSK, ONLINE, AGGREGATOR

  @Column({ type: 'varchar', length: 30, default: 'DRAFT' })
  state: OrderState;

  @Column({ type: 'varchar', length: 30, default: 'DRAFT' })
  status: string; // legacy alias for state

  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency_code: string;

  @Column({ type: 'varchar', length: 40, default: '1' })
  quote_version: string;

  @Column({ type: 'uuid', nullable: true })
  customer_id: string;

  @Column({ type: 'uuid', nullable: true })
  customer_address_id: string;

  @Column({ type: 'uuid', nullable: true })
  delivery_zone_id: string;

  @Column({ type: 'uuid', nullable: true })
  table_id: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  table_number: string;

  @Column({ type: 'integer', nullable: true })
  guest_count: number;

  @Column({ type: 'uuid', nullable: true })
  price_group_id: string;

  @Column({ type: 'uuid', nullable: true })
  discount_id: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  coupon_code: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  business_date: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  subtotal: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  subtotal_amount: string; // legacy alias

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  modifier_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  packaging_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  delivery_fee: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  discount_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  discount_amount: string; // legacy alias

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  tax_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  tax_amount: string; // legacy alias

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  grand_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  total_amount: string; // legacy alias

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  paid_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  paid_amount: string; // legacy alias

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  refunded_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  outstanding_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  due_amount: string; // legacy alias

  @Column({ type: 'varchar', length: 30, default: 'PENDING' })
  fulfillment_status: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'uuid', nullable: true })
  cancellation_reason_code_id: string;

  @Column({ type: 'timestamptz', nullable: true })
  submitted_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date;

  @Column({ type: 'uuid', nullable: true })
  parent_order_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  placed_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date;

  @VersionColumn({ default: 1 })
  version: number;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @OneToMany(() => OrderAdjustment, (adj) => adj.order, { cascade: true })
  adjustments: OrderAdjustment[];

  @OneToMany(() => OrderNote, (n) => n.order, { cascade: true })
  orderNotes: OrderNote[];

  @OneToMany(() => OrderStateEvent, (evt) => evt.order, { cascade: true })
  stateEvents: OrderStateEvent[];
}
