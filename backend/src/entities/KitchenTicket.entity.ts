import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('kitchen_ticket')
@Index(['tenant_id', 'order_id', 'station_id'], { unique: true })
export class KitchenTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid', nullable: true })
  branch_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'uuid' })
  station_id: string;

  @Column({ type: 'varchar', length: 32 })
  ticket_number: string;

  @Column({ type: 'varchar', length: 32, default: 'NEW' }) // NEW, IN_PROGRESS, READY, RECALLED, CANCELLED
  state: string;

  @Column({ type: 'varchar', length: 32, default: 'NEW' }) // Backwards-compatible status alias
  status: string;

  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ type: 'boolean', default: false })
  is_aggregator: boolean;

  @Column({ type: 'int', default: 0 })
  prep_time_seconds: number;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  ready_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  bumped_at: Date;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
