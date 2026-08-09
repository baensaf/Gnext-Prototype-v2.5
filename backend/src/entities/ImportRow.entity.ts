import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type ImportRowStatus = 'STAGED' | 'VALID' | 'INVALID' | 'IMPORTED';

@Entity('import_row')
export class ImportRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  job_id: string;

  @Column({ type: 'int' })
  row_number: number;

  @Column({ type: 'jsonb' })
  raw_data: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  parsed_data: Record<string, any>;

  @Column({ type: 'varchar', length: 20, default: 'STAGED' })
  status: ImportRowStatus;

  @Column({ type: 'jsonb', nullable: true })
  errors: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
