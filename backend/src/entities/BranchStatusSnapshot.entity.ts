import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('branch_status_snapshot')
export class BranchStatusSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'boolean', default: true })
  is_online: boolean;

  @Column({ type: 'varchar', length: 40, nullable: true })
  agent_version: string;

  @Column({ type: 'varchar', length: 20, default: 'HEALTHY' })
  agent_health: string;

  @Column({ type: 'timestamptz', nullable: true })
  last_heartbeat_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_sync_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  offline_since: Date;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  recorded_at: Date;
}
