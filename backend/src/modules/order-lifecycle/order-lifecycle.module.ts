import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { CustomerModule } from '../customer/customer.module';
import { OrderTransitionRecorder } from './order-transition-recorder.service';

/**
 * Kept apart from OrderModule because OrderModule imports the kitchen and delivery modules,
 * and those need to record the order transitions their own work causes.
 */
@Module({
  imports: [AuditModule, OutboxModule, CustomerModule],
  providers: [OrderTransitionRecorder],
  exports: [OrderTransitionRecorder],
})
export class OrderLifecycleModule {}
