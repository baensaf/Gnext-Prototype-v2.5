import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('sync_category_log')
export class SyncCategoryLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'uuid' })
  batch_id: string;

  @Column({ type: 'varchar', length: 64 })
  category: string;

  @Column({ type: 'integer', default: 0 })
  processed_count: number;

  @Column({ type: 'integer', default: 0 })
  synced_count: number;

  @Column({ type: 'integer', default: 0 })
  conflict_count: number;

  @Column({ type: 'integer', default: 0 })
  dlq_count: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
