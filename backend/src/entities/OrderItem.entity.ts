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

  @Column({ type: 'uuid' })
  product_id: string;

  @Column({ type: 'varchar', length: 160 })
  product_name: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  unit_price: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '1.0000' })
  quantity: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  subtotal: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  tax_amount: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  discount_amount: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  total_amount: string;

  @Column({ type: 'text', nullable: true })
  special_instructions: string;

  @ManyToOne(() => OrderHeader, (header) => header.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: OrderHeader;

  @OneToMany(() => OrderItemOption, (opt) => opt.order_item, { cascade: true })
  options: OrderItemOption[];
}
