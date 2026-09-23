import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * A branch snapshot the cloud served to its agent (protocol §12.2). Kept for 30 days, so an
 * order the branch took offline can be checked against the prices its till was given.
 */
@Entity('agent_data_snapshot')
@Index(['tenant_id', 'branch_id', 'data_version'], { unique: true })
export class AgentDataSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  /** Hash of the snapshot's content (§12.2). */
  @Column({ type: 'varchar', length: 64 })
  data_version: string;

  @Column({ type: 'jsonb' })
  body: Record<string, any>;

  @Column({ type: 'timestamptz' })
  first_served_at: Date;

  @Column({ type: 'timestamptz' })
  last_served_at: Date;
}
