import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { OrderHeader } from './OrderHeader.entity';

@Entity('order_note')
export class OrderNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'uuid', nullable: true })
  order_item_id: string | null;

  @Column({ type: 'varchar', length: 20, default: 'GENERAL' })
  note_type: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'varchar', length: 32, default: 'STAFF' })
  source: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @ManyToOne(() => OrderHeader, (order) => order.notes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: OrderHeader;
}
