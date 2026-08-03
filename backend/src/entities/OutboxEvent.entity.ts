import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('outbox_event')
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 80 })
  event_type: string;

  @Column({ type: 'varchar', length: 40 })
  aggregate_type: string;

  @Column({ type: 'uuid' })
  aggregate_id: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  state: string; // PENDING, PROCESSING, SUCCEEDED, FAILED

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @CreateDateColumn({ type: 'timestamptz' })
  available_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  locked_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processed_at: Date;

  @Column({ type: 'text', nullable: true })
  error: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
