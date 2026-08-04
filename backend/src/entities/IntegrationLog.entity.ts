import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('integration_log')
export class IntegrationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 64 })
  provider: string; // SNAPPFOOD, TARA_PAY, NETWORK_POS, PRINTER

  @Column({ type: 'varchar', length: 64 })
  event_type: string; // WEBHOOK_RECEIVED, HMAC_VERIFIED, ORDER_CREATED, DUPLICATE_REJECTED, TARA_BNPL_RESERVED, TARA_BNPL_SETTLED

  @Column({ type: 'varchar', length: 128, nullable: true })
  hmac_signature: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  idempotency_key: string;

  @Column({ type: 'boolean', default: false })
  is_duplicate: boolean;

  @Column({ type: 'varchar', length: 32, default: 'SUCCESS' }) // SUCCESS, FAILED, REJECTED
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  request_payload: any;

  @Column({ type: 'jsonb', nullable: true })
  response_payload: any;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
