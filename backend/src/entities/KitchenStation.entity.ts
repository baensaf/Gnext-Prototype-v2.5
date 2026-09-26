import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';

@Entity('kitchen_station')
export class KitchenStation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 32, default: 'HOT_KITCHEN' }) // HOT_KITCHEN, COLD_KITCHEN, BAR, BAKERY, PACKAGING
  station_type: string;

  @Column({ type: 'int', default: 10 })
  target_minutes: number;

  /**
   * The printers this station's chits print on, every one of them, in this order. Empty: the
   * branch's kitchen printer prints them, as it does for a station whose printers are all out
   * of service.
   */
  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  printer_ids: string[];

  /** How many copies of each chit each of its printers prints. */
  @Column({ type: 'int', default: 1 })
  copies: number;

  /** COMPACT or DETAILED chits; null takes the kitchen chit's default. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  ticket_template?: 'COMPACT' | 'DETAILED' | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at?: Date;
}
