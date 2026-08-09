import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { OrderHeader } from './OrderHeader.entity';

@Entity('order_adjustment')
export class OrderAdjustment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'uuid', nullable: true })
  order_item_id: string | null;

  @Column({ type: 'varchar', length: 24, default: 'DISCOUNT' })
  type: string;

  @Column({ type: 'varchar', length: 32, default: 'CAMPAIGN' })
  source_type: string;

  @Column({ type: 'uuid', nullable: true })
  source_id: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  code: string | null;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  amount: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  funding_source: string | null;

  @Column({ type: 'jsonb', nullable: true })
  calculation_snapshot: any;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => OrderHeader, (order) => order.adjustments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: OrderHeader;
}
