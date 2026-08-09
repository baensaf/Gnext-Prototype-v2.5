import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type ImportEntityType = 'CUSTOMERS' | 'PRODUCTS' | 'CATEGORIES';
export type ImportJobStatus = 'STAGED' | 'MAPPED' | 'VALIDATED' | 'COMPLETED' | 'FAILED';

@Entity('import_job')
export class ImportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 50 })
  entity_type: ImportEntityType;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 50, default: 'STAGED' })
  status: ImportJobStatus;

  @Column({ type: 'int', default: 0 })
  total_rows: number;

  @Column({ type: 'int', default: 0 })
  valid_rows: number;

  @Column({ type: 'int', default: 0 })
  error_rows: number;

  @Column({ type: 'jsonb', nullable: true })
  column_mapping: Record<string, string>;

  @Column({ type: 'jsonb', nullable: true })
  value_mapping: Record<string, Record<string, string>>;

  @Column({ type: 'jsonb', nullable: true })
  error_summary: Array<{ row: number; column: string; message: string }>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
