import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../../entities/Customer.entity';
import { CustomerPhone } from '../../entities/CustomerPhone.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { CustomerCreditAccount } from '../../entities/CustomerCreditAccount.entity';
import { CreditEntry } from '../../entities/CreditEntry.entity';
import { CustomerDiscount } from '../../entities/CustomerDiscount.entity';
import { CustomFieldDefinition } from '../../entities/CustomFieldDefinition.entity';
import { CustomerCustomValue } from '../../entities/CustomerCustomValue.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { CustomerService } from './customer.service';
import { CreditService } from './credit.service';
import { CustomerController } from './customer.controller';
import { CreditController } from './credit.controller';
import { AuditModule } from '../audit/audit.module';
import { CustomFieldsService } from './custom-fields.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Customer,
      CustomerPhone,
      CustomerAddress,
      CustomerCreditAccount,
      CreditEntry,
      CustomerDiscount,
      CustomFieldDefinition,
      CustomerCustomValue,
      OrderHeader,
    ]),
    AuditModule,
  ],
  providers: [CustomerService, CreditService, CustomFieldsService],
  controllers: [CustomerController, CreditController],
  exports: [CustomerService, CreditService, CustomFieldsService],
})
export class CustomerModule {}
