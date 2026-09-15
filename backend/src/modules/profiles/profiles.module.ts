import { Module } from '@nestjs/common';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { CustomerModule } from '../customer/customer.module';
import { DeliveryModule } from '../delivery/delivery.module';

@Module({
  imports: [CustomerModule, DeliveryModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}
