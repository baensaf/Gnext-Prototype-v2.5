import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

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
  entity_type: string; // ORDER, PAYMENT, REFUND, CASH_SHIFT, CUSTOMER, CATALOG, PRICE_UPDATE, SETTING, COURIER

  @Column({ type: 'jsonb' })
  payload: any;

  @Column({ type: 'varchar', length: 32, default: 'PENDING' }) // PENDING, SYNCING, SYNCED, CONFLICT, DLQ_FAILED
  status: string;

  @Column({ type: 'integer', default: 0 })
  retry_count: number;

  @Column({ type: 'integer', default: 0 })
  attempt_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  next_attempt_at: Date | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  claimed_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  claimed_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  claim_expires_at: Date | null;

  @Column({ type: 'text', nullable: true })
  failure_reason: string | null;

  @Column({ type: 'text', nullable: true })
  conflict_reason: string | null;

  @Column({ type: 'integer', default: 1 })
  client_version: number;

  @Column({ type: 'integer', nullable: true })
  server_version: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  dedupe_key: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  synced_at: Date | null;
}
