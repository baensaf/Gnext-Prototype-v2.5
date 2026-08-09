import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('report_export_job')
export class ReportExportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 60 })
  report_code: string;

  @Column({ type: 'varchar', length: 10, default: 'CSV' })
  format: 'CSV' | 'XLSX';

  @Column({ type: 'jsonb', nullable: true })
  filters: Record<string, any>;

  @Column({ type: 'varchar', length: 20, default: 'COMPLETED' })
  status: 'PENDING' | 'COMPLETED' | 'FAILED';

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ type: 'integer', nullable: true })
  file_size: number;

  @Column({ type: 'text', nullable: true })
  file_content_base64: string;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date;
}
