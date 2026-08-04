import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { OrderItem } from './OrderItem.entity';

@Entity('order_item_option')
export class OrderItemOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  order_item_id: string;

  @Column({ type: 'uuid' })
  option_item_id: string;

  @Column({ type: 'varchar', length: 160 })
  option_group_name: string;

  @Column({ type: 'varchar', length: 160 })
  option_item_name: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  price_delta: string;

  @ManyToOne(() => OrderItem, (item) => item.options, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_item_id' })
  order_item: OrderItem;
}
