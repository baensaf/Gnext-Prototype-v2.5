import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A batch of coupon codes, made by head office for one campaign (an SMS to the club, say):
 * what each code gives, when it can be used, and how many codes were made. The reward is a
 * percent off the order or one free item. Till orders only.
 *
 * A SHARED batch is one code head office chooses, typed by many customers (HamiClub's 10%,
 * 15% and 20% codes, 2026-11-12), within limits per customer and in all.
 */
export type CouponReward = 'PERCENT' | 'FREE_ITEM';
export type CouponKind = 'ONE_TIME' | 'SHARED';

@Entity('coupon_batch')
@Index(['tenant_id', 'created_at'])
export class CouponBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  reward_type: CouponReward;

  /** PERCENT: the percent off the order. */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  percent: string | null;

  /** PERCENT: the most a code takes off, in rials; no cap when empty. */
  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  max_discount: string | null;

  /** FREE_ITEM: the product given free (one of it), which must be on the order. */
  @Column({ type: 'uuid', nullable: true })
  reward_product_id: string | null;

  /** The order's subtotal must reach this, in rials; no minimum when empty. */
  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  min_subtotal: string | null;

  /** First and last business day the codes work, YYYY-MM-DD; open-ended when empty. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  valid_from: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  valid_to: string | null;

  /** Switched off, no code in the batch works any more. */
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'int' })
  code_count: number;

  @Column({ type: 'varchar', length: 12, default: 'ONE_TIME' })
  kind: CouponKind;

  /** SHARED: how many orders one customer may use the code on; no limit when empty. */
  @Column({ type: 'int', nullable: true })
  uses_per_customer: number | null;

  /** SHARED: how many of those on one business day. */
  @Column({ type: 'int', nullable: true })
  uses_per_customer_per_day: number | null;

  /** SHARED: how many orders in all, every customer together. */
  @Column({ type: 'int', nullable: true })
  max_uses: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
