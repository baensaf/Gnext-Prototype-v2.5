import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DiscountCampaign } from './DiscountCampaign.entity';

export type ScopeType =
  | 'BRANCH'
  | 'CUSTOMER'
  | 'CUSTOMER_TAG'
  | 'CUSTOMER_SEGMENT'
  | 'PRODUCT'
  | 'CATEGORY'
  | 'CHANNEL'
  | 'ORDER_TYPE';

@Entity('discount_scope')
export class DiscountScope {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  campaign_id: string;

  @Column({ type: 'varchar', length: 32 })
  scope_type: ScopeType;

  @Column({ type: 'varchar', length: 128, nullable: true })
  scope_id: string | null;

  @Column({ type: 'boolean', default: false })
  is_exclusion: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => DiscountCampaign, (campaign) => campaign.scopes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: DiscountCampaign;
}
