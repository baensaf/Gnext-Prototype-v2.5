import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { UsersService, UserWriteDto } from './users.service';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';

/**
 * Who works where, and with what authority, is a decision about the chain rather than
 * about any one shop, so the whole controller sits with head office.
 */
@Controller('api/v1/users')
@HeadOfficeOnly()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(@Req() req: Request) {
    return await this.usersService.list((req as any).tenantId);
  }

  @Post()
  async create(@Body() body: UserWriteDto, @Req() req: Request) {
    return await this.usersService.create(
      (req as any).tenantId,
      body,
      (req as any).userId,
      (req as any).correlationId,
    );
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UserWriteDto, @Req() req: Request) {
    return await this.usersService.update(
      (req as any).tenantId,
      id,
      body,
      (req as any).userId,
      (req as any).correlationId,
    );
  }
}
