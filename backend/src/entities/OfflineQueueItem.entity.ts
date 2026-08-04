import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('offline_queue_item')
export class OfflineQueueItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'uuid', nullable: true })
  terminal_id: string;

  @Column({ type: 'varchar', length: 64 })
  entity_type: string; // ORDER, PAYMENT, CASH_SHIFT, INVENTORY_ADJUSTMENT

  @Column({ type: 'jsonb' })
  payload: any;

  @Column({ type: 'varchar', length: 32, default: 'PENDING' }) // PENDING, SYNCING, SYNCED, CONFLICT, DLQ_FAILED
  status: string;

  @Column({ type: 'integer', default: 0 })
  retry_count: number;

  @Column({ type: 'text', nullable: true })
  conflict_reason: string;

  @Column({ type: 'integer', default: 1 })
  client_version: number;

  @Column({ type: 'integer', nullable: true })
  server_version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  synced_at: Date;
}
