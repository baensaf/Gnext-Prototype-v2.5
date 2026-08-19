import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, VersionColumn } from 'typeorm';

@Entity('coupon')
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid', nullable: true })
  campaign_id: string;

  @Column({ type: 'uuid', nullable: true })
  discount_id: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'integer', nullable: true })
  max_uses: number | null;

  @Column({ type: 'integer', default: 0 })
  uses_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  effective_from: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  effective_to: Date | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  get max_redemptions(): number | null {
    return this.max_uses;
  }
  set max_redemptions(val: number | null) {
    this.max_uses = val;
  }

  get current_redemptions(): number {
    return this.uses_count;
  }
  set current_redemptions(val: number) {
    this.uses_count = val;
  }

  get starts_at(): Date | null {
    return this.effective_from;
  }
  set starts_at(val: Date | null) {
    this.effective_from = val;
  }

  get expires_at(): Date | null {
    return this.effective_to;
  }
  set expires_at(val: Date | null) {
    this.effective_to = val;
  }

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

