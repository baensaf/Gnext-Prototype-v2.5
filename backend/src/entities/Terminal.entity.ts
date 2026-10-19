import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, VersionColumn, DeleteDateColumn } from 'typeorm';

@Entity('terminal')
export class Terminal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'CASHIER' })
  terminal_type: string; // CASHIER, KIOSK

  /** A kiosk's card terminal: the Saman device the branch agent charges its guests on. */
  @Column({ type: 'uuid', nullable: true })
  payment_device_id: string | null;

  /**
   * Where the till's receipts, guest bills and courier slips print. Empty: the branch's
   * receipt printer.
   */
  @Column({ type: 'uuid', nullable: true })
  receipt_printer_id: string | null;

  /** COMPACT or DETAILED receipts; null takes each document's default. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  receipt_template: 'COMPACT' | 'DETAILED' | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  /**
   * The device this register is paired with: an id its browser made up and keeps. One device
   * per register; a request that names the register from any other device is refused.
   */
  @Column({ type: 'uuid', nullable: true })
  device_id: string | null;

  /** The paired device as people know it: the PC's name, else its browser and system. */
  @Column({ type: 'varchar', length: 160, nullable: true })
  device_name: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  device_paired_at: Date | null;

  /** When the paired device last made a request as this register. */
  @Column({ type: 'timestamptz', nullable: true })
  last_seen_at: Date;

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
