import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * One code of a coupon batch. It works once: the order it was used on is kept, and a
 * cancelled order gives it back.
 */
@Entity('coupon')
@Index(['tenant_id', 'code'], { unique: true })
@Index(['tenant_id', 'batch_id'])
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  batch_id: string;

  @Column({ type: 'varchar', length: 16 })
  code: string;

  @Column({ type: 'timestamptz', nullable: true })
  used_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  used_order_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  used_branch_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
