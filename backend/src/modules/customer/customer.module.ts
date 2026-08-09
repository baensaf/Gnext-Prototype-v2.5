import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerGroup } from '../../entities/CustomerGroup.entity';
import { Customer } from '../../entities/Customer.entity';
import { CustomerPhone } from '../../entities/CustomerPhone.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { CustomerCreditAccount } from '../../entities/CustomerCreditAccount.entity';
import { CustomerCreditTransaction } from '../../entities/CustomerCreditTransaction.entity';
import { CreditEntry } from '../../entities/CreditEntry.entity';
import { CustomFieldDefinition } from '../../entities/CustomFieldDefinition.entity';
import { CustomerCustomValue } from '../../entities/CustomerCustomValue.entity';
import { CustomerTag } from '../../entities/CustomerTag.entity';
import { CustomerTagLink } from '../../entities/CustomerTagLink.entity';
import { CustomerSegment } from '../../entities/CustomerSegment.entity';
import { CustomerConsent } from '../../entities/CustomerConsent.entity';
import { CustomerMerge } from '../../entities/CustomerMerge.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { CustomerService } from './customer.service';
import { CreditService } from './credit.service';
import { CustomerController } from './customer.controller';
import { CreditController } from './credit.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomerGroup,
      Customer,
      CustomerPhone,
      CustomerAddress,
      CustomerCreditAccount,
      CustomerCreditTransaction,
      CreditEntry,
      CustomFieldDefinition,
      CustomerCustomValue,
      CustomerTag,
      CustomerTagLink,
      CustomerSegment,
      CustomerConsent,
      CustomerMerge,
      OrderHeader,
    ]),
    AuditModule,
  ],
  providers: [CustomerService, CreditService],
  controllers: [CustomerController, CreditController],
  exports: [CustomerService, CreditService],
})
export class CustomerModule {}
