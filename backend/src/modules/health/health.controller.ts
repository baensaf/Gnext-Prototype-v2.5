import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('live')
  getLive() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async getReady(@Res() res: Response) {
    try {
      const isConnected = this.dataSource.isInitialized;
      if (isConnected) {
        await this.dataSource.query('SELECT 1');
        return res.status(HttpStatus.OK).json({
          status: 'ready',
          database: 'connected',
          timestamp: new Date().toISOString(),
        });
      }
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'not_ready',
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'not_ready',
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
