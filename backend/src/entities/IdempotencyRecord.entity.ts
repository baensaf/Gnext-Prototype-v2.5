import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('idempotency_record')
@Index(['tenant_id', 'scope', 'key'], { unique: true })
export class IdempotencyRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 80 })
  scope: string;

  @Column({ type: 'varchar', length: 160 })
  key: string;

  @Column({ type: 'char', length: 64 })
  request_hash: string;

  @Column({ type: 'varchar', length: 20 })
  status: string; // PENDING, SUCCEEDED, FAILED

  @Column({ type: 'integer', nullable: true })
  response_status: number;

  @Column({ type: 'jsonb', nullable: true })
  response_body: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz' })
  expires_at: Date;
}
