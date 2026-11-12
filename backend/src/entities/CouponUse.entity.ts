import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * One order a shared coupon code went on: who used it, where and on which business day, so
 * the code's limits per customer, per day and in all can be counted. A cancelled order gives
 * its use back. One-time codes keep their single use on the coupon row itself.
 */
@Entity('coupon_use')
@Index(['coupon_id', 'order_id'], { unique: true })
@Index(['coupon_id', 'customer_id', 'business_date'])
export class CouponUse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  coupon_id: string;

  @Column({ type: 'uuid' })
  batch_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'uuid' })
  customer_id: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string | null;

  @Column({ type: 'varchar', length: 10 })
  business_date: string;

  @CreateDateColumn({ type: 'timestamptz' })
  used_at: Date;
}
