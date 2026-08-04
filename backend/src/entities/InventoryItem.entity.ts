import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, VersionColumn } from 'typeorm';

@Entity('inventory_item')
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  product_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  quantity_on_hand: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '10.0000' })
  reorder_level: string;

  @Column({ type: 'varchar', length: 30, default: 'UNIT' })
  unit_of_measure: string;

  @Column({ type: 'timestamptz', nullable: true })
  last_counted_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date;

  @VersionColumn({ default: 1 })
  version: number;
}
