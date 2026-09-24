import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Branch } from '../../entities/Branch.entity';
import { BusinessDayClose } from '../../entities/BusinessDayClose.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { addDays } from '../../common/utils/business-day';
import { BusinessDayService } from './business-day.service';

const SWEEP_MS = 5 * 60_000;
/** How far back auto-close looks for a day still waiting on its shifts. */
const LOOKBACK_DAYS = 7;

export interface AutoCloseOutcome {
  businessDate: string;
  currencyCode: string;
  outcome: 'CLOSED' | 'WAITING_FOR_SHIFTS' | 'FAILED';
  detail?: string;
}

/**
 * Closes each branch's business day by itself once the day has ended at its cutoff and every
 * shift on it has been counted and closed. Nobody has to press "Close Business Day" for the
 * date to move on or for the next shift to open; this is the bookkeeping that follows.
 *
 * It leaves alone: a day a manager closed or reopened (reopening is a person's decision to
 * keep it open), a day with nothing on it, a day still waiting on a drawer, and any day
 * before the branch started running this way (`since`), so nothing in the past is touched.
 */
@Injectable()
export class BusinessDayAutoCloseService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BusinessDayAutoCloseService.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    private readonly businessDays: BusinessDayService,
    private readonly dataSource: DataSource,
  ) {}

  async processBranch(tenantId: string, branchId: string, now: Date = new Date()): Promise<AutoCloseOutcome[]> {
    const em = this.dataSource.manager;
    const clock = await loadBusinessClock(em, tenantId, branchId);
    if (!clock.policy.autoClose) return [];

    const today = clock.today(now);
    let first = addDays(today, -LOOKBACK_DAYS);
    if (clock.policy.since && clock.policy.since > first) first = clock.policy.since;

    const outcomes: AutoCloseOutcome[] = [];
    for (let date = first; date < today; date = addDays(date, 1)) {
      for (const currencyCode of await this.currenciesTradedOn(tenantId, branchId, date)) {
        const closed = await em.findOne(BusinessDayClose, {
          where: { tenant_id: tenantId, branch_id: branchId, business_date: date, currency_code: currencyCode },
        });
        if (closed) continue;

        const openShifts = await em.count(CashierShift, {
          where: { tenant_id: tenantId, branch_id: branchId, business_date: date, currency_code: currencyCode, state: In(['OPEN', 'CLOSING_REVIEW']) },
        });
        if (openShifts > 0) {
          outcomes.push({ businessDate: date, currencyCode, outcome: 'WAITING_FOR_SHIFTS', detail: `${openShifts} shift(s) not yet closed` });
          continue;
        }

        try {
          await this.businessDays.closeBusinessDay(
            tenantId,
            { branchId, businessDate: date, currencyCode },
            undefined,
            `auto-close:${branchId}:${date}`,
            { automatic: true, ordersFrom: clock.policy.since, now },
          );
          outcomes.push({ businessDate: date, currencyCode, outcome: 'CLOSED' });
        } catch (err) {
          // A manager closing the same day at the same moment wins; anything else is logged
          // and tried again next sweep.
          const detail = (err as Error)?.message;
          outcomes.push({ businessDate: date, currencyCode, outcome: 'FAILED', detail });
          this.logger.warn(`Auto-close of ${date} at branch ${branchId} failed: ${detail}`);
        }
      }
    }
    return outcomes;
  }

  /** The currencies a branch sold or kept a drawer in on a day; none means nothing to close. */
  private async currenciesTradedOn(tenantId: string, branchId: string, date: string): Promise<string[]> {
    const rows: { currency_code: string | null }[] = await this.dataSource.query(
      `SELECT DISTINCT currency_code FROM cashier_shift WHERE tenant_id = $1 AND branch_id = $2 AND business_date = $3
       UNION
       SELECT DISTINCT currency_code FROM order_header
        WHERE tenant_id = $1 AND branch_id = $2 AND business_date = $3 AND deleted_at IS NULL
          AND state NOT IN ('DRAFT')`,
      [tenantId, branchId, date],
    );
    return [...new Set(rows.map((r) => r.currency_code || 'IRR'))].sort();
  }

  onApplicationBootstrap() {
    // Tests drive processBranch themselves, and a live timer would keep Jest from exiting.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const branches = await this.branchRepo.find({ where: { is_active: true } });
      for (const b of branches) await this.processBranch(b.tenant_id, b.id);
    } catch (err) {
      this.logger.error(`Business-day auto-close sweep failed: ${(err as Error)?.message}`);
    } finally {
      this.sweeping = false;
    }
  }
}
