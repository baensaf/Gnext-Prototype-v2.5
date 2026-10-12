import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  VersionColumn,
  OneToMany,
  Unique,
} from 'typeorm';
import { CreditEntry } from './CreditEntry.entity';

export type CreditMode = 'FINITE' | 'UNLIMITED' | 'POLICY';

/**
 * CREDIT is pay later: a limit, and a balance that never goes above zero (what is owed).
 * WALLET is cashback the customer earned: a balance that never goes below zero. A customer
 * has at most one of each; the two never share a balance.
 */
export type AccountKind = 'CREDIT' | 'WALLET';

@Entity('credit_account')
@Unique(['tenant_id', 'customer_id', 'currency_code', 'kind'])
export class CustomerCreditAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  customer_id: string;

  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency_code: string;

  @Column({ type: 'varchar', length: 10, default: 'CREDIT' })
  kind: AccountKind;

  @Column({ type: 'varchar', length: 16, default: 'FINITE' })
  mode: CreditMode;

  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  credit_limit: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  current_balance: string;

  @Column({ type: 'text', nullable: true })
  policy_note: string;

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

  @OneToMany(() => CreditEntry, (entry) => entry.account, { cascade: true })
  entries: CreditEntry[];
}
