import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEvent } from '../../entities/AuditEvent.entity';
import { AuditWriter } from './audit-writer.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditEvent])],
  providers: [AuditWriter],
  exports: [AuditWriter],
})
export class AuditModule {}
