import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUser } from '../../entities/AdminUser.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { Printer } from '../../entities/Printer.entity';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AgentGatewayModule } from '../agent-gateway/agent-gateway.module';
import { AgentLocalController } from './agent-local.controller';
import { AgentLocalService } from './agent-local.service';

/** Device management for the branch agent's local settings page. */
@Module({
  imports: [TypeOrmModule.forFeature([AdminUser, Printer, PaymentDevice]), AuthModule, AuditModule, AgentGatewayModule],
  controllers: [AgentLocalController],
  providers: [AgentLocalService],
})
export class AgentLocalModule {}
