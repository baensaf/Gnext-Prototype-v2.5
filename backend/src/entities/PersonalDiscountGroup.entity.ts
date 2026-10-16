import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A personal discount group head office sets: who is in it (owners, branch staff with over a
 * year, ...), the percent they get, and how much of it a month allows. Each person on the
 * customer list is put in one group. Iran Burger's staff scheme has nine (2026-10-16).
 */
@Entity('personal_discount_group')
@Index(['tenant_id', 'is_active'])
export class PersonalDiscountGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'numeric', precision: 5, scale: 2 })
  percent: string;

  /** How much of their orders the discount covers in a calendar month; null is no limit. */
  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  monthly_cap: string | null;

  /** How many orders a month may carry it; null is no limit. */
  @Column({ type: 'int', nullable: true })
  uses_per_month: number | null;

  /** How much of one order it covers; the rest of the order is full price. Null is no limit. */
  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  per_visit_cap: string | null;

  /** True: any branch. False: only the branch the person works at. */
  @Column({ type: 'boolean', default: false })
  any_branch: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
