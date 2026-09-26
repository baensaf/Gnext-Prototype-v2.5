import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('print_job')
export class PrintJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'varchar', length: 64 })
  document_type: string;

  @Column({ type: 'varchar', length: 64 })
  entity_type: string;

  @Column({ type: 'uuid' })
  entity_id: string;

  @Column({ type: 'uuid', nullable: true })
  printer_id?: string;

  /** The prep station a kitchen chit is for; empty for other documents and unrouted lines. */
  @Column({ type: 'uuid', nullable: true })
  station_id?: string;

  /** The station a kitchen chit is for, e.g. "Grill (1/3)". Other documents leave it empty. */
  @Column({ type: 'varchar', length: 160, nullable: true })
  label?: string;

  @Column({ type: 'varchar', length: 32, default: 'QUEUED' }) // QUEUED, PROCESSING (with the agent), SUCCESS, FAILED, CANCELLED
  status: string;

  @Column({ type: 'int', default: 1 })
  copies: number;

  @Column({ type: 'text' })
  rendered_html: string;

  @Column({ type: 'boolean', default: false })
  is_reprint: boolean;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'uuid', nullable: true })
  created_by?: string;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at?: Date;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
