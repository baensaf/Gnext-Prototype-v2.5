import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from '../../entities/OutboxEvent.entity';
import { OutboxWriter } from './outbox-writer.service';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent])],
  providers: [OutboxWriter],
  exports: [OutboxWriter],
})
export class OutboxModule {}
