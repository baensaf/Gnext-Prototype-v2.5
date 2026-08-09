import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  VersionColumn,
  OneToMany,
} from 'typeorm';
import { DiscountScope } from './DiscountScope.entity';

@Entity('discount_campaign')
export class DiscountCampaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 30, default: 'PERCENTAGE' })
  discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_ITEM' | 'FREE_DELIVERY';

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  percentage: string | null;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  amount: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency_code: string | null;

  @Column({ type: 'integer', default: 30 })
  priority: number;

  @Column({ type: 'varchar', length: 40, default: 'DEFAULT', nullable: true })
  stacking_group: string | null;

  @Column({ type: 'boolean', default: true })
  is_stackable: boolean;

  @Column({ type: 'boolean', default: false })
  coupon_required: boolean;

  @Column({ type: 'integer', nullable: true })
  usage_limit_total: number | null;

  @Column({ type: 'integer', nullable: true })
  usage_limit_per_customer: number | null;

  @Column({ type: 'integer', default: 0 })
  usage_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  effective_from: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  effective_to: Date | null;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  minimum_subtotal: string | null;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  maximum_discount_amount: string | null;

  @Column({ type: 'uuid', nullable: true })
  reward_product_id: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 3, nullable: true })
  reward_quantity: string | null;

  @Column({ type: 'varchar', length: 80, default: 'MERCHANT' })
  funding_source: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date;

  @VersionColumn({ default: 1 })
  version: number;

  @OneToMany(() => DiscountScope, (scope) => scope.campaign, { cascade: true })
  scopes: DiscountScope[];
}
