import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { Request } from 'express';
import { ProfilesService } from './profiles.service';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { Courier } from '../../entities/Courier.entity';

/**
 * Each profile is reachable by exactly who can reach its list today: customers and accounts
 * are run centrally by head office, a courier belongs to the branch that employs them.
 */
@Controller('api/v1')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @HeadOfficeOnly()
  @Get('customers/:id/profile')
  async customerProfile(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.profilesService.customerProfile((req as any).tenantId, id);
  }

  @BranchOwned(Courier)
  @Get('delivery/couriers/:id/profile')
  async courierProfile(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.profilesService.courierProfile((req as any).tenantId, id);
  }

  @HeadOfficeOnly()
  @Get('users/:id/profile')
  async userProfile(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.profilesService.userProfile((req as any).tenantId, id);
  }
}
