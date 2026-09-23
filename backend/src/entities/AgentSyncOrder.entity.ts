import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

export type AgentSyncOrderStatus = 'ACCEPTED' | 'HELD';

/**
 * An order a branch took while offline, as its agent uploaded it (protocol §12.5). Saved
 * before it is booked, so nothing the branch sent is lost if booking fails; a held one is
 * retried from here. The id is the agent's, and becomes the cloud order's id.
 */
@Entity('agent_sync_order')
@Index(['tenant_id', 'status', 'received_at'])
export class AgentSyncOrder {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'uuid' })
  agent_id: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  /** SHA-256 of the payload as received, so a resend is told from a different order under the same id. */
  @Column({ type: 'varchar', length: 64 })
  payload_hash: string;

  @Column({ type: 'varchar', length: 16 })
  status: AgentSyncOrderStatus;

  /** What a person should look at (§12.6), e.g. PRICE_CHANGED, or why it is held. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  flags: string[];

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  order_number?: string | null;

  @Column({ type: 'timestamptz' })
  received_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  booked_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by?: string | null;
}
