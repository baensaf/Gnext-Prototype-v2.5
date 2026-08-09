import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './modules/health/health.controller';
import { SessionGuard } from './common/guards/session.guard';
import { CsrfGuard } from './common/guards/csrf.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { IdempotencyService } from './common/services/idempotency.service';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { SettingsModule } from './modules/settings/settings.module';
import { MediaModule } from './modules/media/media.module';
import { LocalizationModule } from './modules/localization/localization.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { DiscountsModule } from './modules/discounts/discounts.module';
import { CustomerModule } from './modules/customer/customer.module';
import { OrderModule } from './modules/order/order.module';
import { PaymentModule } from './modules/payment/payment.module';
import { CashDrawerModule } from './modules/cash-drawer/cash-drawer.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ApprovalModule } from './modules/approval/approval.module';
import { RefundModule } from './modules/refund/refund.module';
import { DineInModule } from './modules/dine-in/dine-in.module';
import { KdsModule } from './modules/kds/kds.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { CashierModule } from './modules/cashier/cashier.module';
import { KioskModule } from './modules/kiosk/kiosk.module';
import { SimulationModule } from './modules/simulation/simulation.module';
import { OfflineSyncModule } from './modules/offline-sync/offline-sync.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ImportExportModule } from './modules/import-export/import-export.module';
import { ImportJob } from './entities/ImportJob.entity';
import { ImportRow } from './entities/ImportRow.entity';

import { RefundRequest } from './entities/RefundRequest.entity';
import { RefundItem } from './entities/RefundItem.entity';
import { RefundAllocation } from './entities/RefundAllocation.entity';
import { Refund } from './entities/Refund.entity';
import { DiningArea } from './entities/DiningArea.entity';
import { DiningTable } from './entities/DiningTable.entity';
import { TableSession } from './entities/TableSession.entity';
import { TableEvent } from './entities/TableEvent.entity';
import { TableOccupancyEvent } from './entities/TableOccupancyEvent.entity';
import { KitchenStation } from './entities/KitchenStation.entity';
import { KitchenTicket } from './entities/KitchenTicket.entity';
import { KitchenTicketItem } from './entities/KitchenTicketItem.entity';
import { PrinterDevice } from './entities/PrinterDevice.entity';

import { Tenant } from './entities/Tenant.entity';
import { AdminUser } from './entities/AdminUser.entity';
import { Session } from './entities/Session.entity';
import { AuditEvent } from './entities/AuditEvent.entity';
import { OutboxEvent } from './entities/OutboxEvent.entity';
import { IdempotencyRecord } from './entities/IdempotencyRecord.entity';

import { Branch } from './entities/Branch.entity';
import { BranchOperatingHour } from './entities/BranchOperatingHour.entity';
import { Terminal } from './entities/Terminal.entity';
import { BranchStatusSnapshot } from './entities/BranchStatusSnapshot.entity';
import { TenantSetting } from './entities/TenantSetting.entity';
import { Currency } from './entities/Currency.entity';
import { PaymentMethod } from './entities/PaymentMethod.entity';
import { ReasonCode } from './entities/ReasonCode.entity';

import { FileAsset } from './entities/FileAsset.entity';
import { LocalizedString } from './entities/LocalizedString.entity';

import { Category } from './entities/Category.entity';
import { Product } from './entities/Product.entity';
import { OptionGroup } from './entities/OptionGroup.entity';
import { OptionItem } from './entities/OptionItem.entity';
import { ProductOptionGroup } from './entities/ProductOptionGroup.entity';
import { PriceGroup } from './entities/PriceGroup.entity';
import { PriceGroupItem } from './entities/PriceGroupItem.entity';
import { PriceEntry } from './entities/PriceEntry.entity';
import { PriceGroupBranch } from './entities/PriceGroupBranch.entity';
import { PriceBulkJob } from './entities/PriceBulkJob.entity';
import { Menu } from './entities/Menu.entity';
import { MenuCategory } from './entities/MenuCategory.entity';
import { MenuProduct } from './entities/MenuProduct.entity';
import { ProductAvailability } from './entities/ProductAvailability.entity';

import { ApprovalRule } from './entities/ApprovalRule.entity';
import { ApprovalRequest } from './entities/ApprovalRequest.entity';
import { ApprovalDecision } from './entities/ApprovalDecision.entity';
import { PinAttemptLog } from './entities/PinAttemptLog.entity';

import { Discount } from './entities/Discount.entity';
import { Coupon } from './entities/Coupon.entity';
import { DiscountCampaign } from './entities/DiscountCampaign.entity';
import { DiscountScope } from './entities/DiscountScope.entity';
import { DiscountUsage } from './entities/DiscountUsage.entity';

import { CustomerGroup } from './entities/CustomerGroup.entity';
import { Customer } from './entities/Customer.entity';
import { CustomerPhone } from './entities/CustomerPhone.entity';
import { CustomerAddress } from './entities/CustomerAddress.entity';
import { CustomerCreditAccount } from './entities/CustomerCreditAccount.entity';
import { CustomerCreditTransaction } from './entities/CustomerCreditTransaction.entity';
import { CreditEntry } from './entities/CreditEntry.entity';
import { CustomFieldDefinition } from './entities/CustomFieldDefinition.entity';
import { CustomerCustomValue } from './entities/CustomerCustomValue.entity';
import { CustomerTag } from './entities/CustomerTag.entity';
import { CustomerTagLink } from './entities/CustomerTagLink.entity';
import { CustomerSegment } from './entities/CustomerSegment.entity';
import { CustomerConsent } from './entities/CustomerConsent.entity';
import { CustomerMerge } from './entities/CustomerMerge.entity';

import { OrderHeader } from './entities/OrderHeader.entity';
import { OrderItem } from './entities/OrderItem.entity';
import { OrderItemOption } from './entities/OrderItemOption.entity';
import { OrderAdjustment } from './entities/OrderAdjustment.entity';
import { OrderNote } from './entities/OrderNote.entity';
import { OrderLink } from './entities/OrderLink.entity';
import { OrderStateEvent } from './entities/OrderStateEvent.entity';
import { OrderSequence } from './entities/OrderSequence.entity';

import { Payment } from './entities/Payment.entity';
import { SettlementAccount } from './entities/SettlementAccount.entity';
import { PaymentDevice } from './entities/PaymentDevice.entity';
import { PaymentAllocation } from './entities/PaymentAllocation.entity';
import { PaymentAttempt } from './entities/PaymentAttempt.entity';

import { Courier } from './entities/Courier.entity';
import { DeliveryAssignment } from './entities/DeliveryAssignment.entity';
import { CourierSettlement } from './entities/CourierSettlement.entity';
import { CourierSettlementLine } from './entities/CourierSettlementLine.entity';

import { CashierShift } from './entities/CashierShift.entity';
import { CashMovement } from './entities/CashMovement.entity';
import { BusinessDayClose } from './entities/BusinessDayClose.entity';
import { CashDrawerShift } from './entities/CashDrawerShift.entity';
import { CashDrawerTransaction } from './entities/CashDrawerTransaction.entity';

import { InventoryItem } from './entities/InventoryItem.entity';
import { InventoryTransaction } from './entities/InventoryTransaction.entity';
import { IntegrationLog } from './entities/IntegrationLog.entity';
import { OfflineQueueItem } from './entities/OfflineQueueItem.entity';
import { SyncConflictRecord } from './entities/SyncConflictRecord.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: parseInt(config.get<string>('DB_PORT', '5432'), 10),
        username: config.get<string>('DB_USER', 'admin'),
        password: config.get<string>('DB_PASSWORD', 'admin'),
        database: config.get<string>('DB_NAME', 'appdb'),
        entities: [
          Tenant, AdminUser, Session, AuditEvent, OutboxEvent, IdempotencyRecord,
          Branch, BranchOperatingHour, Terminal, BranchStatusSnapshot, TenantSetting,
          Currency, PaymentMethod, ReasonCode,
          FileAsset, LocalizedString,
          Category, Product, OptionGroup, OptionItem, ProductOptionGroup, PriceGroup, PriceGroupItem,
          PriceEntry, PriceGroupBranch, PriceBulkJob,
          Menu, MenuCategory, MenuProduct, ProductAvailability,
          ApprovalRule, ApprovalRequest, ApprovalDecision, PinAttemptLog,
          Discount, Coupon, DiscountCampaign, DiscountScope, DiscountUsage,
          CustomerGroup, Customer, CustomerPhone, CustomerAddress, CustomerCreditAccount, CustomerCreditTransaction, CreditEntry,
          CustomFieldDefinition, CustomerCustomValue, CustomerTag, CustomerTagLink, CustomerSegment,
          CustomerConsent, CustomerMerge,
          OrderHeader, OrderItem, OrderItemOption, OrderAdjustment, OrderNote, OrderLink, OrderStateEvent, OrderSequence,
          Payment, SettlementAccount, PaymentDevice, PaymentAllocation, PaymentAttempt,
          RefundRequest, RefundItem, RefundAllocation, Refund,
          DiningArea, DiningTable, TableSession, TableEvent, TableOccupancyEvent,
          KitchenStation, KitchenTicket, KitchenTicketItem, PrinterDevice,
          Courier, DeliveryAssignment, CourierSettlement, CourierSettlementLine,
          CashierShift, CashMovement, BusinessDayClose, CashDrawerShift, CashDrawerTransaction,
          InventoryItem, InventoryTransaction, IntegrationLog,
          OfflineQueueItem, SyncConflictRecord,
          ImportJob, ImportRow,
        ],
        synchronize: false, // Mandatory AD-02
        logging: config.get<string>('NODE_ENV') === 'development' ? ['error', 'warn'] : false,
      }),
    }),
    AuthModule,
    AuditModule,
    OutboxModule,
    TenantModule,
    SettingsModule,
    MediaModule,
    LocalizationModule,
    CatalogModule,
    PricingModule,
    DiscountsModule,
    CustomerModule,
    OrderModule,
    PaymentModule,
    CashDrawerModule,
    CashierModule,
    InventoryModule,
    ApprovalModule,
    RefundModule,
    DineInModule,
    KdsModule,
    DeliveryModule,
    KioskModule,
    SimulationModule,
    OfflineSyncModule,
    ReportsModule,
    ImportExportModule,
    TypeOrmModule.forFeature([AdminUser, Session, IdempotencyRecord]),
  ],
  controllers: [HealthController],
  providers: [
    IdempotencyService,
    {
      provide: APP_GUARD,
      useClass: SessionGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
