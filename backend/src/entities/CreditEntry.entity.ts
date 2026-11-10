import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CustomerCreditAccount } from './CustomerCreditAccount.entity';

export type CreditEntryType =
  | 'PURCHASE'
  | 'REPAYMENT'
  | 'REVERSAL'
  | 'LOYALTY_CASHBACK'
  | 'LOYALTY_CASHBACK_REVERSAL'
  // A balance moved between a customer's credit account and wallet (the 2026-10-12 split).
  | 'TRANSFER'
  // Wallet credit carried over from the customer's old club (HamiClub) at a branch's switch.
  | 'OPENING_BALANCE'
  // What was left of a wallet credit on the day after its last day.
  | 'EXPIRY';

@Entity('credit_entry')
@Index(['account_id', 'posted_at'])
export class CreditEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  account_id: string;

  @Column({ type: 'varchar', length: 30 })
  entry_type: CreditEntryType;

  @Column({ type: 'numeric', precision: 19, scale: 4 })
  amount: string; // signed: negative for PURCHASE (credit or wallet spend), positive for REPAYMENT and cashback

  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency_code: string;

  @Column({ type: 'uuid', nullable: true })
  order_id: string;

  @Column({ type: 'uuid', nullable: true })
  payment_id: string;

  @Column({ type: 'uuid', nullable: true })
  related_entry_id: string;

  @Column({ type: 'text', nullable: true })
  reason_text: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  reference: string;

  @Column({ type: 'varchar', length: 10 })
  business_date: string;

  @CreateDateColumn({ type: 'timestamptz' })
  posted_at: Date;

  @Column({ type: 'uuid', nullable: true })
  posted_by: string;

  @Column({ type: 'numeric', precision: 19, scale: 4, default: '0.0000' })
  balance_after: string;

  /**
   * A wallet entry that put money in is a credit of its own: what is still unspent of it, the
   * business day it can first be spent, and its last day. Spending takes the credit that ends
   * soonest first; what is left after the last day goes out as an EXPIRY entry. Null on entries
   * that took money out, and on credit accounts.
   */
  @Column({ type: 'numeric', precision: 19, scale: 4, nullable: true })
  remaining: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  available_from: string | null;

  /** Null: the credit never expires (wallet money from before 2026-11-10). */
  @Column({ type: 'varchar', length: 10, nullable: true })
  expires_on: string | null;

  @ManyToOne(() => CustomerCreditAccount, (acc) => acc.entries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: CustomerCreditAccount;
}
