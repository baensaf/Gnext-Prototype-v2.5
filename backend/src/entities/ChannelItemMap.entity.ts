import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/** What a menu record is to an aggregator. Snappfood sells each type of a product as a product of its own. */
export type ChannelEntityType = 'CATEGORY' | 'PRODUCT' | 'VARIANT' | 'OPTION_GROUP' | 'OPTION_ITEM';

/**
 * Our menu as an aggregator knows it (simulated for Snappfood, 2026-10-12). Snappfood keys
 * menus, products and toppings by OUR integer ids ("ID in your dataset", at most 10 digits),
 * and a topping id may never equal a product id, so every record gets one integer from a single
 * sequence per tenant and channel. Snappfood's own sync codes (productCode, categoryCode) and
 * topping group ids are per vendor, and each branch is a vendor, so they are kept per branch.
 */
@Entity('channel_item_map')
@Index('uq_channel_item_map_entity', ['tenant_id', 'channel', 'entity_type', 'entity_id'], { unique: true })
@Index('uq_channel_item_map_external', ['tenant_id', 'channel', 'external_id'], { unique: true })
export class ChannelItemMap {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  /** SNAPPFOOD; later TALABAT and others, each with its own numbers. */
  @Column({ type: 'varchar', length: 32 })
  channel: string;

  @Column({ type: 'varchar', length: 16 })
  entity_type: ChannelEntityType;

  @Column({ type: 'uuid' })
  entity_id: string;

  /** The integer we send as our id: menu id, productId, toppingId. */
  @Column({ type: 'integer' })
  external_id: number;

  /**
   * Per branch (vendor): the aggregator's own code for this record, once matched or created
   * there. Snappfood's productCode / categoryCode, or its toppingGroupId for a group.
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  channel_codes: Record<string, string>;

  /** Per branch: when the record was last sent. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  synced_at: Record<string, string>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
