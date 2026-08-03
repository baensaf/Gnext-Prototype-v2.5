import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LocalizedString } from '../../entities/LocalizedString.entity';
import { LocalizationService } from './localization.service';
import { LocalizationController } from './localization.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LocalizedString])],
  providers: [LocalizationService],
  controllers: [LocalizationController],
  exports: [LocalizationService],
})
export class LocalizationModule {}
