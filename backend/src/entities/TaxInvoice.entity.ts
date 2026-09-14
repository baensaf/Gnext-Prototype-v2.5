import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';

/**
 * One electronic invoice for the Moadian tax system: the original for a sale, or a
 * cancellation or return pointing back at it. The payload is the invoice JSON as it
 * would be sent; the tax office's answer is simulated in this prototype.
 */
@Entity('tax_invoice')
@Unique(['tenant_id', 'tax_id'])
@Index(['tenant_id', 'status'])
@Index(['tenant_id', 'order_id'])
export class TaxInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string | null;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  order_number: string | null;

  /** Set on a return invoice: the refund it records. */
  @Column({ type: 'uuid', nullable: true })
  refund_id: string | null;

  /** 1 original, 3 cancellation, 4 return. */
  @Column({ type: 'smallint' })
  subject: number;

  @Column({ type: 'varchar', length: 22 })
  tax_id: string;

  @Column({ type: 'integer' })
  serial: number;

  @Column({ type: 'varchar', length: 22, nullable: true })
  reference_tax_id: string | null;

  /** QUEUED, PENDING, SUCCESS, FAILED */
  @Column({ type: 'varchar', length: 20, default: 'QUEUED' })
  status: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  reference_number: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, default: 0 })
  total_amount: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, default: 0 })
  vat_amount: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  errors: { code: string; message: string }[] | null;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz' })
  issued_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
