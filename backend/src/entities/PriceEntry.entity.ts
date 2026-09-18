import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('price_entry')
@Index(['tenant_id', 'product_id', 'effective_from'])
export class PriceEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  product_id: string;

  @Column({ type: 'uuid', nullable: true })
  variant_id: string;

  @Column({ type: 'uuid', nullable: true })
  modifier_option_id: string;

  @Column({ type: 'uuid', nullable: true })
  price_group_id: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  channel: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  order_type: string;

  @Column({ type: 'char', length: 3, default: 'IRR' })
  currency_code: string;

  @Column({ type: 'varchar', length: 32, default: 'BASE' })
  price_type: string;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  effective_from: Date;

  @Column({ type: 'timestamptz', nullable: true })
  effective_to: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  /** The dated price change (price_bulk_job) this row belongs to, if any. */
  @Column({ type: 'uuid', nullable: true })
  bulk_job_id: string | null;
}
