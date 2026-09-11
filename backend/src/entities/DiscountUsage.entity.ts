import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('discount_usage')
export class DiscountUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  /** A redemption of a coupon — the only discount that is counted against a limit. */
  @Column({ type: 'uuid' })
  coupon_id: string;

  @Column({ type: 'uuid', nullable: true })
  customer_id: string | null;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  amount: string;

  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency_code: string;

  @CreateDateColumn({ type: 'timestamptz' })
  used_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  reversed_at: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  snapshot: any;
}
