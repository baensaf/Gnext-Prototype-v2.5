import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Courier } from '../../entities/Courier.entity';
import { DeliveryAssignment } from '../../entities/DeliveryAssignment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';
import { CourierSettlementLine } from '../../entities/CourierSettlementLine.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { ApprovalRequest } from '../../entities/ApprovalRequest.entity';
import { DeliveryService } from './delivery.service';
import { DeliveryController } from './delivery.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Courier,
      DeliveryAssignment,
      OrderHeader,
      CourierSettlement,
      CourierSettlementLine,
      Payment,
      PaymentMethod,
      ApprovalRequest,
    ]),
    AuditModule,
  ],
  providers: [DeliveryService],
  controllers: [DeliveryController],
  exports: [DeliveryService],
})
export class DeliveryModule {}
