import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, VersionColumn } from 'typeorm';

@Entity('tenant')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'char', length: 3, default: 'IRR' })
  base_currency: string;

  @Column({ type: 'varchar', length: 5, default: 'fa' })
  default_locale: string;

  @Column({ type: 'varchar', length: 64, default: 'Asia/Tehran' })
  time_zone: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @VersionColumn({ default: 1 })
  version: number;
}
