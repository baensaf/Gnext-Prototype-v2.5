import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * How many of an item a branch has for one business day — "we made 20 of the lasagne".
 * Only today's row matters; tomorrow starts with no limit until someone sets one. What is
 * left is the quantity less what today's live orders already hold, worked out when asked,
 * so a voided line or a cancelled order gives its units back without bookkeeping.
 */
@Entity('daily_stock')
export class DailyStock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'uuid' })
  product_id: string;

  /** Set when the count is for one variant; null counts the product as a whole. */
  @Column({ type: 'uuid', nullable: true })
  variant_id: string | null;

  @Column({ type: 'date' })
  business_date: string;

  @Column({ type: 'integer' })
  quantity: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
