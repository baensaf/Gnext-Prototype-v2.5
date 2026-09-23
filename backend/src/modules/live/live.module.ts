import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { LiveChangesService } from './live-changes.service';
import { LiveController } from './live.controller';

/** Pushes "this board changed" to open pages, so they need not poll. */
@Module({
  imports: [ConfigModule, AuthModule],
  providers: [LiveChangesService],
  exports: [LiveChangesService],
  controllers: [LiveController],
})
export class LiveModule {}
