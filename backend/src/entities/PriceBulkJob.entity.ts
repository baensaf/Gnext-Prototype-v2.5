import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('price_bulk_job')
export class PriceBulkJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 32, default: 'COMPLETED' })
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  params: Record<string, any>;

  @Column({ type: 'integer', default: 0 })
  affected_rows: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;
}
