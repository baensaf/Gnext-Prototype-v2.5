import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('table_event')
export class TableEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  table_session_id: string;

  @Column({ type: 'varchar', length: 64 }) // SEATED, ORDER_PLACED, ITEM_ADDED, BILL_REQUESTED, PAID, VACATED
  event_type: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
