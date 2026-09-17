import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, VersionColumn } from 'typeorm';

@Entity('product')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sku: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  barcode: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'uuid' })
  category_id: string;

  @Column({ type: 'varchar', length: 20, default: 'UNIT' })
  unit_of_measure: string;

  @Column({ type: 'numeric', precision: 5, scale: 4, default: '0.0000' })
  tax_rate: string;

  @Column({ type: 'uuid', nullable: true })
  image_asset_id: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  base_price: string;

  /**
   * COMBO is a meal deal sold as one line at its own price: its option groups are the slots
   * (side, drink) and every slot must be filled when it is ordered. Choices may name the
   * product they give, and carry an upcharge.
   */
  @Column({ type: 'varchar', length: 20, default: 'STANDARD' })
  product_type: 'STANDARD' | 'COMBO';

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
}
