import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('dining_table')
export class DiningTable {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  dining_area_id: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 32 })
  table_number: string;

  @Column({ type: 'int', default: 4 })
  seating_capacity: number;

  @Column({ type: 'varchar', length: 32, default: 'RECTANGLE' }) // RECTANGLE, CIRCLE, SQUARE
  shape: string;

  @Column({ type: 'int', default: 0 })
  pos_x: number;

  @Column({ type: 'int', default: 0 })
  pos_y: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
