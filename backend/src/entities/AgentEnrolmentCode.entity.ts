import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * A one-time code head office hands to whoever installs the agent at a branch. The agent
 * trades it for a device key. Only a hash is kept, so a leaked table cannot enrol anyone.
 */
@Entity('agent_enrolment_code')
export class AgentEnrolmentCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  /** SHA-256 of the normalised code (upper case, no hyphen), hex. */
  @Column({ type: 'varchar', length: 64, unique: true })
  code_hash: string;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  used_at?: Date | null;

  /** The agent this code enrolled. */
  @Column({ type: 'uuid', nullable: true })
  agent_id?: string | null;

  /** Set when head office withdraws the code before anyone used it. */
  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  created_by?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
