import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A group of customers head office keeps: staff, owners, regulars, top spenders. A customer
 * can be in several. A group is only a list of people; a group discount picks the groups it
 * covers. Groups are filled by hand today; an automatic kind (rules on spend and visits)
 * comes later beside MANUAL.
 */
@Entity('customer_group')
@Index(['tenant_id', 'is_active'])
export class CustomerGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  /** MANUAL: people are added by hand. */
  @Column({ type: 'varchar', length: 16, default: 'MANUAL' })
  kind: string;

  /** Branch managers may add and remove their own branch's people. Otherwise head office only. */
  @Column({ type: 'boolean', default: false })
  branch_can_assign: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
