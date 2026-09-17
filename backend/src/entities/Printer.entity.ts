import type { DeviceConnection } from '../common/utils/device-connection.util';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';

@Entity('printer')
export class Printer {
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

  @Column({ type: 'varchar', length: 32, default: 'THERMAL_RECEIPT' }) // THERMAL_RECEIPT, KITCHEN_IMPACT, LABEL
  printer_type: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  simulated_address?: string;

  @Column({ type: 'int', default: 80 })
  paper_width_mm: number;

  /**
   * How the branch agent reaches this printer. Set, and every job for it goes through the
   * agent; empty, and the printer stays on the simulator.
   */
  @Column({ type: 'jsonb', nullable: true })
  agent_connection?: DeviceConnection | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'uuid', nullable: true })
  fallback_printer_id?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at?: Date;
}
