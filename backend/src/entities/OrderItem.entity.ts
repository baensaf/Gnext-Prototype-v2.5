import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { OrderHeader } from './OrderHeader.entity';
import { OrderItemOption } from './OrderItemOption.entity';

@Entity('order_item')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'integer', default: 1 })
  line_number: number;

  @Column({ type: 'uuid' })
  product_id: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  product_code: string;

  @Column({ type: 'varchar', length: 160 })
  product_name: string;

  @Column({ type: 'uuid', nullable: true })
  variant_id: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  variant_name: string;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: '1.0000' })
  quantity: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  unit_price: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  base_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  subtotal: string; // legacy alias

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  modifier_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  discount_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  discount_amount: string; // legacy alias

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  tax_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  tax_amount: string; // legacy alias

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  packaging_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  line_total: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  total_amount: string; // legacy alias

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'text', nullable: true })
  special_instructions: string; // legacy alias

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  state: string; // ACTIVE, VOID, REPLACED

  @Column({ type: 'uuid', nullable: true })
  replaces_item_id: string;

  @ManyToOne(() => OrderHeader, (header) => header.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: OrderHeader;

  @OneToMany(() => OrderItemOption, (opt) => opt.order_item, { cascade: true })
  options: OrderItemOption[];
}
