import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('sync_conflict_record')
export class SyncConflictRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  queue_item_id: string;

  @Column({ type: 'varchar', length: 64 })
  conflict_type: string; // PRICE_MISMATCH, OUT_OF_STOCK, SHIFT_CLOSED

  @Column({ type: 'jsonb' })
  client_state: any;

  @Column({ type: 'jsonb' })
  server_state: any;

  @Column({ type: 'varchar', length: 32, default: 'UNRESOLVED' }) // UNRESOLVED, ACCEPT_CLIENT, ACCEPT_SERVER, MANUAL_OVERRIDE
  resolution_strategy: string;

  @Column({ type: 'uuid', nullable: true })
  resolved_by: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date;
}
