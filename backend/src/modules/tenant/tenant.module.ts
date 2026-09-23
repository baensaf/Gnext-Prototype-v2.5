import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../../entities/Tenant.entity';
import { Branch } from '../../entities/Branch.entity';
import { BranchOperatingHour } from '../../entities/BranchOperatingHour.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, Branch, BranchOperatingHour, Terminal]),
    AuditModule,
  ],
  providers: [TenantService],
  controllers: [TenantController],
  exports: [TenantService],
})
export class TenantModule {}
