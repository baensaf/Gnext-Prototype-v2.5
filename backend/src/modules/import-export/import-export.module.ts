import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportJob } from '../../entities/ImportJob.entity';
import { ImportRow } from '../../entities/ImportRow.entity';
import { Customer } from '../../entities/Customer.entity';
import { Product } from '../../entities/Product.entity';
import { Category } from '../../entities/Category.entity';
import { ImportExportService } from './import-export.service';
import { ImportExportController } from './import-export.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportJob, ImportRow, Customer, Product, Category]),
    AuditModule,
  ],
  controllers: [ImportExportController],
  providers: [ImportExportService],
  exports: [ImportExportService],
})
export class ImportExportModule {}
