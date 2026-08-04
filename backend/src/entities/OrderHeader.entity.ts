import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, VersionColumn, OneToMany } from 'typeorm';
import { OrderItem } from './OrderItem.entity';

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

  @Column({ type: 'varchar', length: 32 })
  order_number: string;

  @Column({ type: 'varchar', length: 30, default: 'DINE_IN' })
  order_type: string; // DINE_IN, TAKEAWAY, DELIVERY, AGGREGATOR

  @Column({ type: 'varchar', length: 30, default: 'SUBMITTED' })
  status: string; // DRAFT, SUBMITTED, KITCHEN_PREPARING, READY, COMPLETED, CANCELLED, REFUNDED

  @Column({ type: 'uuid', nullable: true })
  customer_id: string;

  @Column({ type: 'uuid', nullable: true })
  customer_address_id: string;

  @Column({ type: 'uuid', nullable: true })
  price_group_id: string;

  @Column({ type: 'uuid', nullable: true })
  discount_id: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  coupon_code: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  subtotal_amount: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  tax_amount: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  discount_amount: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  total_amount: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  paid_amount: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  due_amount: string;

  @Column({ type: 'varchar', length: 30, default: 'PENDING' })
  fulfillment_status: string; // PENDING, PREPARING, READY, DELIVERED

  @Column({ type: 'varchar', length: 20, nullable: true })
  table_number: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'uuid', nullable: true })
  cancellation_reason_code_id: string;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date;

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
}
