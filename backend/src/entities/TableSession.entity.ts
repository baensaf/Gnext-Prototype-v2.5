import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('table_session')
export class TableSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  table_id: string;

  @Column({ type: 'uuid', nullable: true })
  active_order_id: string;

  @Column({ type: 'varchar', length: 32, default: 'OCCUPIED' }) // AVAILABLE, OCCUPIED, RESERVED, BILL_PRINTED, CLEANING
  status: string;

  @Column({ type: 'int', default: 2 })
  guest_count: number;

  @CreateDateColumn({ type: 'timestamptz' })
  seated_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
