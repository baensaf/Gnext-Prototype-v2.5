import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CustomerService } from '../customer/customer.service';

/** A profile is a summary, not a report: it carries the recent end of each history. */
const ORDER_LIMIT = 100;
const HISTORY_LIMIT = 50;
const AUDIT_LIMIT = 200;

/** Keys an audit payload may carry that a profile never shows, whoever is looking. */
const SECRET_KEY = /password|pin_hash|pin$|^pin|hash|card_number|token/i;

export function maskAuditPayload(value: any): any {
  if (Array.isArray(value)) return value.map(maskAuditPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      SECRET_KEY.test(key) ? '***MASKED***' : maskAuditPayload(inner),
    ]),
  );
}

/**
 * One page per customer or account: who they are, the orders they touched, the
 * money that moved, and the audit trail about them and by them.
 *
 * Everything is read with plain SQL against tables other modules own. A profile never
 * writes, so it borrows their data rather than their services, except for the
 * lookup that already enriches a record the way the rest of the app shows it.
 */
@Injectable()
export class ProfilesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerService: CustomerService,
  ) {}

  async customerProfile(tenantId: string, id: string) {
    const customer: any = await this.customerService.getCustomerById(tenantId, id);
    const account = customer.credit_account;
    const wallet = customer.wallet_account;
    const ledger = (accountId: string) =>
      this.dataSource.query(
        `SELECT id, entry_type, amount, balance_after, currency_code, order_id, reason_text, reference, posted_at
           FROM credit_entry
          WHERE tenant_id = $1 AND account_id = $2
          ORDER BY posted_at DESC
          LIMIT ${HISTORY_LIMIT}`,
        [tenantId, accountId],
      );

    const [summary, entries, walletEntries, audit] = await Promise.all([
      this.orderSummary(tenantId, 'o.customer_id = $2', [id]),
      account ? ledger(account.id) : [],
      wallet ? ledger(wallet.id) : [],
      this.auditTrail(tenantId, `a.entity_id::text IN ($2, $3)`, [id, account?.id ?? id]),
    ]);

    return {
      customer: {
        id: customer.id,
        code: customer.code,
        first_name: customer.first_name,
        last_name: customer.last_name,
        mobile: customer.mobile,
        email: customer.email,
        national_id: customer.national_id,
        is_active: customer.is_active,
        created_at: customer.created_at,
        updated_at: customer.updated_at,
      },
      phones: customer.phones || [],
      addresses: customer.addresses || [],
      stats: summary.stats,
      orders: summary.orders,
      credit: account ? { account, entries } : null,
      wallet: wallet ? { account: wallet, entries: walletEntries } : null,
      groups: customer.groups || [],
      audit,
    };
  }

  async userProfile(tenantId: string, id: string) {
    const [user] = await this.dataSource.query(
      `SELECT u.id, u.username, u.display_name, u.role, u.branch_id, b.name AS branch_name, u.is_active,
              u.preferred_locale, u.last_login_at, u.created_at, u.updated_at,
              (u.pin_hash IS NOT NULL) AS has_pin, creator.display_name AS created_by_name
         FROM admin_user u
         LEFT JOIN branch b ON b.id = u.branch_id
         LEFT JOIN admin_user creator ON creator.id = u.created_by
        WHERE u.tenant_id = $1 AND u.id = $2`,
      [tenantId, id],
    );
    if (!user) throw new NotFoundException('User not found');

    const [summary, shifts, shiftStats, approvals, audit] = await Promise.all([
      this.orderSummary(tenantId, 'o.created_by = $2', [id]),
      this.dataSource.query(
        `SELECT s.id, s.shift_number, s.state, s.business_date, s.opened_at, s.closed_at,
                s.opening_cash, s.expected_cash, s.actual_cash, s.short_over,
                b.name AS branch_name, t.name AS terminal_name,
                (s.opened_by = $2) AS opened_by_user, (s.closed_by = $2) AS closed_by_user
           FROM cashier_shift s
           LEFT JOIN branch b ON b.id = s.branch_id
           LEFT JOIN terminal t ON t.id = s.terminal_id
          WHERE s.tenant_id = $1 AND (s.opened_by = $2 OR s.closed_by = $2)
          ORDER BY s.opened_at DESC
          LIMIT ${HISTORY_LIMIT}`,
        [tenantId, id],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS shift_count,
                COUNT(*) FILTER (WHERE s.closed_at IS NOT NULL)::int AS closed_shift_count,
                COALESCE(SUM(s.short_over) FILTER (WHERE s.closed_at IS NOT NULL), 0)::text AS net_short_over
           FROM cashier_shift s
          WHERE s.tenant_id = $1 AND s.opened_by = $2`,
        [tenantId, id],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS approval_decision_count,
                COUNT(*) FILTER (WHERE decision = 'APPROVED')::int AS approved_count,
                COUNT(*) FILTER (WHERE decision = 'REJECTED')::int AS rejected_count
           FROM approval_decision
          WHERE tenant_id = $1 AND approver_user_id = $2`,
        [tenantId, id],
      ),
      this.auditTrail(
        tenantId,
        // The language switch records itself on every change of the header toggle, and on a
        // demo account it outnumbers everything else put together.
        `a.action <> 'USER_CHANGE_LANGUAGE' AND (
           a.actor_id::text = $2
           OR a.entity_id::text = $2
           -- Account events written before they named their account carried it only in details.
           OR a.details->>'userId' = $2
         )`,
        [id],
      ),
    ]);

    return {
      user,
      stats: { ...summary.stats, ...shiftStats[0], ...approvals[0] },
      orders: summary.orders,
      shifts,
      audit,
    };
  }

  /**
   * Order counts and the recent orders matching `filter`, which reads `$2` onwards.
   * Drafts are carts nobody sent, so they are neither counted nor listed.
   */
  private async orderSummary(tenantId: string, filter: string, params: any[]) {
    const where = `o.tenant_id = $1 AND o.deleted_at IS NULL AND o.state NOT IN ('DRAFT', 'ABANDONED') AND (${filter})`;
    const [stats, orders] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*)::int AS order_count,
                COUNT(*) FILTER (WHERE o.state = 'COMPLETED')::int AS completed_count,
                COUNT(*) FILTER (WHERE o.state IN ('CANCELLED', 'REJECTED'))::int AS cancelled_count,
                COALESCE(SUM(o.grand_total) FILTER (WHERE o.state = 'COMPLETED'), 0)::text AS completed_value,
                COALESCE(ROUND(AVG(o.grand_total) FILTER (WHERE o.state = 'COMPLETED'), 4), 0)::text AS average_value,
                MIN(o.placed_at) AS first_order_at,
                MAX(o.placed_at) AS last_order_at
           FROM order_header o
          WHERE ${where}`,
        [tenantId, ...params],
      ),
      this.dataSource.query(
        `SELECT o.id, o.order_number, o.order_type, o.channel, o.state, o.grand_total, o.currency_code,
                o.placed_at, o.branch_id, b.name AS branch_name
           FROM order_header o
           LEFT JOIN branch b ON b.id = o.branch_id
          WHERE ${where}
          ORDER BY o.placed_at DESC
          LIMIT ${ORDER_LIMIT}`,
        [tenantId, ...params],
      ),
    ]);
    return { stats: stats[0], orders };
  }

  /** The newest audit events matching `filter`, which reads `$2` onwards, with who did each. */
  private async auditTrail(tenantId: string, filter: string, params: string[]) {
    const events = await this.dataSource.query(
      `SELECT a.id, a.action, a.actor_type, a.actor_id, actor.display_name AS actor_name,
              a.entity_type, a.entity_id, a.branch_id, a.correlation_id,
              a.before_data, a.after_data, a.details, a.occurred_at
         FROM audit_event a
         LEFT JOIN admin_user actor ON actor.id = a.actor_id
        WHERE a.tenant_id = $1 AND (${filter})
        ORDER BY a.occurred_at DESC
        LIMIT ${AUDIT_LIMIT}`,
      [tenantId, ...params],
    );
    return events.map((event: any) => ({
      ...event,
      before_data: maskAuditPayload(event.before_data),
      after_data: maskAuditPayload(event.after_data),
      details: maskAuditPayload(event.details),
    }));
  }
}
