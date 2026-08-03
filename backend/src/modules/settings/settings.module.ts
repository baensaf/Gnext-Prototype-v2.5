import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { Currency } from '../../entities/Currency.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { ReasonCode } from '../../entities/ReasonCode.entity';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantSetting, Currency, PaymentMethod, ReasonCode]),
    AuditModule,
  ],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
