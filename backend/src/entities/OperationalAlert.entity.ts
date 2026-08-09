import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('operational_alert')
export class OperationalAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;

  @Column({ type: 'varchar', length: 50 })
  type: string; // CASH_DISCREPANCY, PRINTER_FAULT, INTEGRATION_ERROR, etc.

  @Column({ type: 'varchar', length: 20, default: 'WARNING' })
  severity: 'INFO' | 'WARNING' | 'CRITICAL';

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'boolean', default: false })
  acknowledged: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  acknowledged_by: string;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledged_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
