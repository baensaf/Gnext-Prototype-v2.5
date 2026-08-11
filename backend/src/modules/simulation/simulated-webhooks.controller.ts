import { Controller, Post, Param, Body, Headers, Req, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { SimulationService } from './simulation.service';

@Controller('simulated-webhooks')
export class SimulatedWebhooksController {
  constructor(private readonly simulationService: SimulationService) {}

  @Post('snappfood/:branchCode')
  async handleRawSnappfoodWebhook(
    @Param('branchCode') branchCode: string,
    @Body() body: any,
    @Headers('x-snappfood-signature') signature: string,
    @Headers('x-snappfood-timestamp') timestampHeader: string,
    @Headers('x-snappfood-event-id') eventIdHeader: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required for webhook integration');
    }
    const correlationId = (req as any).correlationId || `corr-snapp-${Date.now()}`;
    const rawBody = (req as any).rawBody || JSON.stringify(body);
    const timestamp = timestampHeader || body.timestamp || new Date().toISOString();
    const eventId = eventIdHeader || body.event_id || body.eventId;

    const payload = {
      ...body,
      event_id: eventId || body.event_id || `evt-${Date.now()}`,
      branch_code: branchCode,
    };

    return await this.simulationService.handleSnappfoodWebhook(
      tenantId,
      rawBody,
      payload,
      signature,
      timestamp,
      'snappfood-secret-key-123',
      correlationId,
    );
  }
}
