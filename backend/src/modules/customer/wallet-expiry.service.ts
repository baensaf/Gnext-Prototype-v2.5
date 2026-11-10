import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { CreditService } from './credit.service';

const SWEEP_MS = 15 * 60_000;

/** Takes what is left of expired wallet credit out of idle wallets, every quarter of an hour. */
@Injectable()
export class WalletExpiryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WalletExpiryService.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(private readonly credit: CreditService) {}

  onApplicationBootstrap() {
    // Tests call expireDueCredits themselves, and a live timer would keep Jest from exiting.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
    void this.sweep();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const wallets = await this.credit.expireDueCredits();
      if (wallets) this.logger.log(`Expired credit taken out of ${wallets} wallet(s)`);
    } catch (err: any) {
      this.logger.warn(`Wallet expiry sweep failed: ${err?.message || err}`);
    } finally {
      this.sweeping = false;
    }
  }
}
