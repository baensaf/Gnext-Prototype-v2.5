import { Entity, PrimaryColumn, Column, Index, UpdateDateColumn } from 'typeorm';

/** Which Snappfood a branch talks to: the simulator, Snappfood's staging servers, or the real one. */
export const SNAPPFOOD_MODES = ['SIMULATED', 'STAGING', 'PRODUCTION'] as const;
export type SnappfoodMode = (typeof SNAPPFOOD_MODES)[number];

/**
 * The chain's webhook on Snappfood (annex 4.3.0, section 5). One address serves every branch:
 * Snappfood names the branch in each order's vendorCode. The token in the address is what
 * proves a call came from Snappfood; the HMAC secret, once Snappfood support switches HMAC on,
 * is checked as well.
 */
@Entity('snappfood_webhook')
export class SnappfoodWebhook {
  @PrimaryColumn({ type: 'uuid' })
  tenant_id: string;

  @Index('uq_snappfood_webhook_token', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  token: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  hmac_secret: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_received_at: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

/**
 * A branch as a Snappfood vendor: the code Snappfood gave it and the API account its calls use
 * (an OAuth2 password grant; Snappfood makes one account per vendor). Kept as entered, like
 * Tara's login: this is a prototype.
 */
@Entity('snappfood_connection')
@Index('uq_snappfood_connection_vendor', ['tenant_id', 'vendor_code'], { unique: true })
export class SnappfoodConnection {
  @PrimaryColumn({ type: 'uuid' })
  branch_id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 16, default: 'SIMULATED' })
  mode: SnappfoodMode;

  @Column({ type: 'varchar', length: 40, nullable: true })
  vendor_code: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  client_id: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  client_secret: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  username: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  password: string | null;

  @Column({ type: 'text', nullable: true })
  access_token: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  token_expires_at: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
