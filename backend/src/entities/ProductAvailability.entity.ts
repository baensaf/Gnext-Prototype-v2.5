import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('product_availability')
export class ProductAvailability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  /** Null for a stop on an add-on (option_item_id), which belongs to no one product. */
  @Column({ type: 'uuid', nullable: true })
  product_id: string | null;

  /** Set when only this variant is off sale (the cold one, not the hot one). */
  @Column({ type: 'uuid', nullable: true })
  variant_id: string | null;

  /** Set when the stop is on an add-on item, which goes off sale on every product it is on. */
  @Column({ type: 'uuid', nullable: true })
  option_item_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  channel: string;

  @Column({ type: 'boolean', default: false })
  is_suspended: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  suspended_until: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
