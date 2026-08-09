import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('kds_event')
export class KdsEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  ticket_id: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  from_state?: string;

  @Column({ type: 'varchar', length: 32 })
  to_state: string;

  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ type: 'uuid', nullable: true })
  occurred_by?: string;

  @Column({ type: 'jsonb', nullable: true })
  details?: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  occurred_at: Date;
}
