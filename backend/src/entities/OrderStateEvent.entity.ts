import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { OrderHeader } from './OrderHeader.entity';

@Entity('order_state_event')
export class OrderStateEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  from_state: string | null;

  @Column({ type: 'varchar', length: 30 })
  to_state: string;

  @Column({ type: 'varchar', length: 40 })
  action: string;

  @Column({ type: 'uuid', nullable: true })
  reason_code_id: string | null;

  @Column({ type: 'text', nullable: true })
  reason_text: string | null;

  @Column({ type: 'uuid', nullable: true })
  approval_request_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  occurred_at: Date;

  @Column({ type: 'uuid', nullable: true })
  occurred_by: string | null;

  @Column({ type: 'jsonb', nullable: true })
  snapshot: any;

  @ManyToOne(() => OrderHeader, (order) => order.stateEvents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: OrderHeader;
}
