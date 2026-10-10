import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { Request } from 'express';
import { ProfilesService } from './profiles.service';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';

/**
 * Customers and accounts are run centrally by head office, and so are their profiles.
 */
@Controller('api/v1')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @HeadOfficeOnly()
  @Get('customers/:id/profile')
  async customerProfile(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.profilesService.customerProfile((req as any).tenantId, id);
  }

  @HeadOfficeOnly()
  @Get('users/:id/profile')
  async userProfile(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.profilesService.userProfile((req as any).tenantId, id);
  }
}
