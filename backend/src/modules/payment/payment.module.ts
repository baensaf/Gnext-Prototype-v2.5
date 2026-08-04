import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../../entities/Payment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { Tenant } from '../../entities/Tenant.entity';
import { Branch } from '../../entities/Branch.entity';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { CustomerModule } from '../customer/customer.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, OrderHeader, PaymentMethod, Tenant, Branch]),
    CustomerModule,
    AuditModule,
  ],
  providers: [PaymentService],
  controllers: [PaymentController],
  exports: [PaymentService],
})
export class PaymentModule {}
