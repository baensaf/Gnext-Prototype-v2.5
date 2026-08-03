import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUser } from '../../entities/AdminUser.entity';
import { Tenant } from '../../entities/Tenant.entity';
import { Session } from '../../entities/Session.entity';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { AuthController } from './auth.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminUser, Tenant, Session]),
    AuditModule,
  ],
  providers: [AuthService, SessionService],
  controllers: [AuthController],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
