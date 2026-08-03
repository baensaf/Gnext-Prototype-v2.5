import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerGroup } from '../../entities/CustomerGroup.entity';
import { Customer } from '../../entities/Customer.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { CustomerCreditAccount } from '../../entities/CustomerCreditAccount.entity';
import { CustomerCreditTransaction } from '../../entities/CustomerCreditTransaction.entity';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomerGroup,
      Customer,
      CustomerAddress,
      CustomerCreditAccount,
      CustomerCreditTransaction,
    ]),
    AuditModule,
  ],
  providers: [CustomerService],
  controllers: [CustomerController],
  exports: [CustomerService],
})
export class CustomerModule {}
