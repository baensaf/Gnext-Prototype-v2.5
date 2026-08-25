import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Payment } from '../../entities/Payment.entity';
import { Refund } from '../../entities/Refund.entity';
import { AuditEvent } from '../../entities/AuditEvent.entity';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';
import { CourierSettlementLine } from '../../entities/CourierSettlementLine.entity';
import { CourierAttendance } from '../../entities/CourierAttendance.entity';
import { Customer } from '../../entities/Customer.entity';
import { CustomerCreditAccount } from '../../entities/CustomerCreditAccount.entity';
import { CreditEntry } from '../../entities/CreditEntry.entity';
import { OrderAdjustment } from '../../entities/OrderAdjustment.entity';
import { DiscountCampaign } from '../../entities/DiscountCampaign.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { PrintJob } from '../../entities/PrintJob.entity';
import { PrintAttempt } from '../../entities/PrintAttempt.entity';
import { Printer } from '../../entities/Printer.entity';
import { Delivery } from '../../entities/Delivery.entity';
import { OfflineQueueItem } from '../../entities/OfflineQueueItem.entity';
import { Product } from '../../entities/Product.entity';
import { Category } from '../../entities/Category.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { SavedReportView } from '../../entities/SavedReportView.entity';
import { ReportExportJob } from '../../entities/ReportExportJob.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { AuditAlertsAliasController } from './audit-alerts-alias.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderHeader,
      OrderItem,
      Payment,
      Refund,
      AuditEvent,
      IntegrationLog,
      CashierShift,
      CourierSettlement,
      CourierSettlementLine,
      CourierAttendance,
      Customer,
      CustomerCreditAccount,
      CreditEntry,
      OrderAdjustment,
      DiscountCampaign,
      PaymentDevice,
      PaymentMethod,
      PrintJob,
      PrintAttempt,
      Printer,
      Delivery,
      OfflineQueueItem,
      Product,
      Category,
      OperationalAlert,
      SavedReportView,
      ReportExportJob,
    ]),
  ],
  providers: [ReportsService],
  controllers: [ReportsController, AuditAlertsAliasController],
  exports: [ReportsService],
})
export class ReportsModule {}
