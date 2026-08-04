import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('printer_device')
export class PrinterDevice {
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

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip_address: string;

  @Column({ type: 'varchar', length: 32, default: 'THERMAL_RECEIPT' }) // THERMAL_RECEIPT, KITCHEN_IMPACT, LABEL
  printer_type: string;

  @Column({ type: 'int', default: 80 }) // 80mm or 58mm
  paper_width_mm: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
