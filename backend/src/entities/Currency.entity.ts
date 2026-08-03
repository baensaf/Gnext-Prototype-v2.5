import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, VersionColumn, DeleteDateColumn } from 'typeorm';

@Entity('currency')
export class Currency {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'char', length: 3 })
  code: string;

  @Column({ type: 'varchar', length: 8 })
  symbol: string;

  @Column({ type: 'smallint', default: 0 })
  decimal_precision: number;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '1.0000' })
  rounding_increment: string;

  @Column({ type: 'boolean', default: true })
  is_enabled: boolean;

  @Column({ type: 'boolean', default: false })
  is_base: boolean;

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
