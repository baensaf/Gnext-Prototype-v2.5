import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type AgentStatus = 'ACTIVE' | 'REVOKED';

/**
 * The local program on a branch PC that bridges the cloud to the branch's printers and card
 * terminals (docs/agent-gateway/agent-protocol.md). A branch has at most one ACTIVE agent;
 * a revoked row stays for the audit trail and never comes back.
 */
@Entity('agent')
@Index('UQ_agent_active_branch', ['branch_id'], { unique: true, where: `"status" = 'ACTIVE'` })
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status: AgentStatus;

  /** SHA-256 of the device key, hex. The key itself is shown to the agent once and never stored. */
  @Column({ type: 'varchar', length: 64, unique: true })
  key_hash: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  agent_version?: string | null;

  @Column({ type: 'int', nullable: true })
  protocol_version?: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  hostname?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  os?: string | null;

  /** Windows MachineGuid, shown to head office to tell PCs apart. Not a credential. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  machine_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  enrolment_code_id?: string | null;

  @Column({ type: 'timestamptz' })
  enrolled_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_seen_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  revoked_by?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  revoke_reason?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
