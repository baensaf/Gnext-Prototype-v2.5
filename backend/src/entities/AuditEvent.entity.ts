import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('audit_event')
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 30 })
  actor_type: string; // ADMIN, APPROVER_PROFILE, SYSTEM, SIMULATOR, WEBHOOK

  @Column({ type: 'uuid', nullable: true })
  actor_id: string;

  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  entity_type: string;

  @Column({ type: 'uuid', nullable: true })
  entity_id: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;

  @Column({ type: 'uuid' })
  correlation_id: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string;

  @Column({ type: 'jsonb', nullable: true })
  before_data: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  after_data: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  occurred_at: Date;
}
