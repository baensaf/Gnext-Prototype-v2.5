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
import { DeliveryZone } from '../../entities/DeliveryZone.entity';
import { CourierAttendance } from '../../entities/CourierAttendance.entity';
import { CourierTerminalAssignment } from '../../entities/CourierTerminalAssignment.entity';
import { Delivery } from '../../entities/Delivery.entity';
import { DeliveryEvent } from '../../entities/DeliveryEvent.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { DeliveryService } from './delivery.service';
import { DeliveryController } from './delivery.controller';
import { CourierSettlementsController } from './courier-settlements.controller';
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
      DeliveryZone,
      CourierAttendance,
      CourierTerminalAssignment,
      Delivery,
      DeliveryEvent,
      CustomerAddress,
      Terminal,
    ]),
    AuditModule,
  ],
  providers: [DeliveryService],
  controllers: [DeliveryController, CourierSettlementsController],
  exports: [DeliveryService],
})
export class DeliveryModule {}
