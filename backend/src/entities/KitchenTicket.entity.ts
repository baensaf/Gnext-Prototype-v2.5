import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('kitchen_ticket')
export class KitchenTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  order_id: string;

  @Column({ type: 'uuid', nullable: true })
  station_id: string;

  @Column({ type: 'varchar', length: 32 })
  ticket_number: string;

  @Column({ type: 'varchar', length: 32, default: 'NEW' }) // NEW, IN_PREPARATION, READY, BUMPED, RECALLED
  status: string;

  @Column({ type: 'int', default: 0 })
  prep_time_seconds: number;

  @Column({ type: 'timestamptz', nullable: true })
  bumped_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
