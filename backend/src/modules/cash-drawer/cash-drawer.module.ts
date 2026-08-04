import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashDrawerShift } from '../../entities/CashDrawerShift.entity';
import { CashDrawerTransaction } from '../../entities/CashDrawerTransaction.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { CashDrawerService } from './cash-drawer.service';
import { CashDrawerController } from './cash-drawer.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CashDrawerShift,
      CashDrawerTransaction,
      Payment,
      PaymentMethod,
    ]),
    AuditModule,
  ],
  providers: [CashDrawerService],
  controllers: [CashDrawerController],
  exports: [CashDrawerService],
})
export class CashDrawerModule {}
