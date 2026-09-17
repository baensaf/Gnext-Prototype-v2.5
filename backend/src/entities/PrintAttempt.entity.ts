import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('print_attempt')
@Index(['job_id', 'attempt_no'], { unique: true })
export class PrintAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  job_id: string;

  @Column({ type: 'uuid' })
  printer_id: string;

  @Column({ type: 'int', default: 1 })
  attempt_no: number;

  @Column({ type: 'varchar', length: 32, default: 'SUCCESS' }) // PENDING (with the agent), SUCCESS, FAILED
  status: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  scenario_id?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  error_code?: string;

  @Column({ type: 'text', nullable: true })
  error_message?: string;

  /** The agent command that carried this attempt; empty for the simulator. */
  @Column({ type: 'uuid', nullable: true })
  agent_command_id?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finished_at?: Date;
}
