import { Entity, PrimaryColumn, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** One of Tara's product groups, as its MerchandiseGroup service lists them. */
export interface TaraGroup {
  tag: string;
  id: number;
  name: string;
  title: string;
}

/** The chain's Tara account, set up once at head office. */
@Entity('tara_connection')
export class TaraConnection {
  @PrimaryColumn({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 120 })
  username: string;

  /** Kept as entered: the Tara this prototype talks to is simulated. */
  @Column({ type: 'varchar', length: 200 })
  password: string;

  /** What the login call returned; used for the terminal and product-group calls. */
  @Column({ type: 'text', nullable: true })
  access_code: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  connected_at: Date | null;

  /** Tara's product groups, as last fetched. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  groups: TaraGroup[];

  /** The group a category nobody mapped is sent under. */
  @Column({ type: 'bigint', nullable: true })
  default_group_id: string | null;

  /** Category id → Tara group id. */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  category_groups: Record<string, number>;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

/** The code Tara gave a branch (its acceptor code). */
@Entity('tara_branch')
export class TaraBranch {
  @PrimaryColumn({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 40 })
  branch_code: string;

  @Column({ type: 'timestamptz', nullable: true })
  terminals_fetched_at: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

/** One of Tara's terminals at a branch, with its long-lived token, given to one till. */
@Entity('tara_terminal')
export class TaraTerminal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'varchar', length: 40 })
  terminal_code: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  terminal_title: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  merchant_code: string | null;

  @Column({ type: 'text' })
  access_code: string;

  /** The till (Terminal) that charges through it. */
  @Column({ type: 'uuid', nullable: true })
  register_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

/** Which Tara call a sale is at. */
export type TaraStep = 'TRACE' | 'REQUEST' | 'VERIFY' | 'DONE' | 'FAILED' | 'REVERSED';
/** The call that got no answer. */
export type TaraCall = 'REQUEST' | 'VERIFY';

/** Gnext's side of one Tara sale: one per payment. */
@Entity('tara_purchase')
export class TaraPurchase {
  @PrimaryColumn({ type: 'uuid' })
  payment_id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'varchar', length: 40 })
  terminal_code: string;

  @Column({ type: 'varchar', length: 64 })
  barcode: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  mobile: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  trace_number: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  reference_number: string | null;

  @Column({ type: 'varchar', length: 16, default: 'TRACE' })
  step: TaraStep;

  /** Set while a call waits for an answer the sweep has to find out. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  awaiting: TaraCall | null;

  @Column({ type: 'timestamptz', nullable: true })
  unanswered_since: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  next_check_at: Date | null;

  @Column({ type: 'integer', default: 0 })
  checks: number;

  /** Two minutes of asking and one more try got nothing: a manager looks at it. */
  @Column({ type: 'boolean', default: false })
  stuck: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  reversed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

export type TaraSimStatus = 'TRACED' | 'HELD' | 'VERIFIED' | 'REVERSED' | 'EXPIRED';

/** The simulated Tara server's own record of a sale. */
@Entity('tara_sim_purchase')
export class TaraSimPurchase {
  @PrimaryColumn({ type: 'varchar', length: 40 })
  trace_number: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 40 })
  terminal_code: string;

  @Column({ type: 'varchar', length: 64 })
  barcode: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  mobile: string | null;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  reference_number: string | null;

  @Column({ type: 'jsonb', nullable: true })
  invoice: any;

  @Column({ type: 'varchar', length: 16, default: 'TRACED' })
  status: TaraSimStatus;

  /** What happened to the sale, as the inquiry service reports it (PurchaseTrack[]). */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  track: Array<{ amount: number; doTime: string; type: string }>;

  /** Calls whose answer the simulator already lost once, so the next one is answered. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  dropped: string[];

  @Column({ type: 'timestamptz', nullable: true })
  held_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
