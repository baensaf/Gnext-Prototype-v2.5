import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { AgentReleaseCiAuthenticated } from './agent-release-ci.guard';
import { AgentReleasesService, MAX_RELEASE_BYTES } from './agent-releases.service';

export class UploadAgentReleaseDto {
  @IsString()
  @MaxLength(32)
  version: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  min_agent_version?: string;
}

/** Head office uploads and publishes builds of the branch agent (protocol §9). */
@HeadOfficeOnly()
@Roles(...MANAGER_AND_ABOVE)
@Controller('api/v1/agent-releases')
export class AgentReleasesController {
  constructor(private readonly releases: AgentReleasesService) {}

  @Get()
  async list() {
    return await this.releases.list();
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RELEASE_BYTES, files: 1 } }))
  async upload(@UploadedFile() file: any, @Body() body: UploadAgentReleaseDto, @Req() req: Request) {
    return await this.releases.upload(
      { version: body.version, notes: body.notes, minAgentVersion: body.min_agent_version, file },
      actorOf(req),
    );
  }

  @Post(':id/publish')
  async publish(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.releases.publish(id, actorOf(req));
  }

  @Post(':id/unpublish')
  async unpublish(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.releases.unpublish(id, actorOf(req));
  }
}

export class CiAgentReleaseDto {
  @IsString()
  @MaxLength(32)
  version: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  commit?: string;
}

/**
 * The pipeline's way in: after each deploy of main, CI offers the agent it built. The build is
 * stored unpublished; publishing stays with head office on the Branch Agents screen.
 */
@AgentReleaseCiAuthenticated()
@Controller('api/v1/agent-releases/ci')
export class AgentReleasesCiController {
  constructor(private readonly releases: AgentReleasesService) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RELEASE_BYTES, files: 1 } }))
  async upload(@UploadedFile() file: any, @Body() body: CiAgentReleaseDto) {
    return await this.releases.uploadFromCi({ version: body.version, commit: body.commit, file });
  }
}

function actorOf(req: Request) {
  return { tenantId: (req as any).tenantId, userId: (req as any).userId };
}
