import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('product_option_group')
export class ProductOptionGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  product_id: string;

  @Column({ type: 'uuid' })
  option_group_id: string;

  @Column({ type: 'integer', default: 0 })
  sort_order: number;

  /** Items of the group this product does not offer, though the group is attached. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  excluded_item_ids: string[];

  /** The category this link came from (the group is on the category); null when put on the product itself. */
  @Column({ type: 'uuid', nullable: true })
  from_category_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
