import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * QUEUED   stored, not yet on the wire
 * SENT     written to the agent's socket, no ack yet
 * ACKED    the agent journalled it; a result will follow (§4.4)
 * DONE     finished: result applied, or acked when the type has no result
 * FAILED   refused by the agent (ack ok:false) or reported as failed
 * EXPIRED  nobody acked it before expires_at
 */
export type AgentCommandStatus = 'QUEUED' | 'SENT' | 'ACKED' | 'DONE' | 'FAILED' | 'EXPIRED';

/**
 * A command the cloud asked a branch agent to run (protocol §4.4, §7). Its id is the envelope
 * id and never changes across redeliveries, so the agent can drop duplicates.
 */
@Entity('agent_command')
@Index('IDX_agent_command_branch_status', ['tenant_id', 'branch_id', 'status'])
@Index('IDX_agent_command_entity', ['entity_type', 'entity_id'])
export class AgentCommand {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'varchar', length: 64 })
  type: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ type: 'varchar', length: 16, default: 'QUEUED' })
  status: AgentCommandStatus;

  /** False for commands the agent only acks (config.updated, agent.check_update). */
  @Column({ type: 'boolean', default: true })
  expects_result: boolean;

  /** What the command is about, e.g. PrintJob / Payment, for the module that sent it. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  entity_type?: string | null;

  @Column({ type: 'uuid', nullable: true })
  entity_id?: string | null;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'int', default: 0 })
  send_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_sent_at?: Date | null;

  /** The agent that acked it: the branch may have changed PCs since it was queued. */
  @Column({ type: 'uuid', nullable: true })
  agent_id?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  acked_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at?: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  error_code?: string | null;

  @Column({ type: 'text', nullable: true })
  error_message?: string | null;

  /** The result envelope's id, so a resent result is recognised. */
  @Column({ type: 'uuid', nullable: true })
  result_message_id?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  result?: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
