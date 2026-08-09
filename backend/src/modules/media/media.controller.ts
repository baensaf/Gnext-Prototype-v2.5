import { Controller, Post, Get, Param, UseInterceptors, UploadedFile, Req, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { MediaService } from './media.service';
import * as path from 'path';
import * as fs from 'fs';

@Controller('api/v1/media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    return await this.mediaService.saveFile(tenantId, file, userId);
  }

  @Get('files/:id')
  async getFileById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.mediaService.getFileById(tenantId, id);
  }

  @Get('uploads/:filename')
  async getUploadedFile(@Param('filename') filename: string, @Res() res: Response) {
    const safeFilename = path.basename(filename);
    const filePath = path.join(process.cwd(), 'uploads', safeFilename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found' });
    }
    return res.sendFile(filePath);
  }
}
