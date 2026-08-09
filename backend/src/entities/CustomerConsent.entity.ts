import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('customer_consent')
export class CustomerConsent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  customer_id: string;

  @Column({ type: 'varchar', length: 64 })
  consent_type: string; // e.g. SMS_MARKETING, EMAIL_PROMOTION, PRIVACY_POLICY

  @Column({ type: 'boolean', default: true })
  granted: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  granted_at: Date;
}
