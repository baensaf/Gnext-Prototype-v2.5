import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';

/**
 * Which prep station makes a product, or every product of a category, at one branch. A
 * product's own rule beats its category's, and there is at most one of each. The kitchen
 * screen and the kitchen printers both follow it.
 */
@Entity('kds_routing_rule')
export class KdsRoutingRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'uuid' })
  station_id: string;

  @Column({ type: 'uuid', nullable: true })
  product_id?: string;

  @Column({ type: 'uuid', nullable: true })
  category_id?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at?: Date;
}
