import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AdminUser } from '../../entities/AdminUser.entity';
import { Branch } from '../../entities/Branch.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([AdminUser, Branch]), AuditModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
