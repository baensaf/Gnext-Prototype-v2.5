import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('table_occupancy_event')
export class TableOccupancyEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  table_id: string;

  @Column({ type: 'uuid', nullable: true })
  order_id: string;

  @Column({ type: 'uuid', nullable: true })
  from_table_id: string;

  @Column({ type: 'varchar', length: 32 }) // SEAT, VACATE, MOVE, MERGE, SPLIT, RELEASE
  event_type: string;

  @Column({ type: 'int', nullable: true })
  guest_count: number;

  @Column({ type: 'uuid', nullable: true })
  occurred_by: string;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  occurred_at: Date;
}
