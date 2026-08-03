import { Controller, Post, Get, Body, Req, Res, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body() body: { username?: string; password?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { username, password } = body;
    if (!username || !password) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        type: 'https://gnext.local/problems/validation',
        title: 'Validation Error',
        status: 400,
        code: 'VALIDATION_FAILED',
        detail: 'Username and password are required.',
        instance: req.url,
        correlationId: (req as any).correlationId,
      });
    }

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const correlationId = (req as any).correlationId;

    const result = await this.authService.login(username, password, ip, userAgent, correlationId);

    // Set HttpOnly SameSite=Lax Cookie
    res.cookie('gnext_session', result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return res.status(HttpStatus.OK).json({
      csrfToken: result.csrfToken,
      user: result.user,
      tenant: result.tenant,
    });
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    const token = req.cookies?.gnext_session;
    const correlationId = (req as any).correlationId;
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;

    await this.authService.logout(token, correlationId, ip);

    res.clearCookie('gnext_session', { path: '/' });
    return res.status(HttpStatus.OK).json({ success: true });
  }

  @Get('me')
  async me(@Req() req: Request, @Res() res: Response) {
    const token = req.cookies?.gnext_session;
    if (!token) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        type: 'https://gnext.local/problems/auth',
        title: 'Not Authenticated',
        status: 401,
        code: 'UNAUTHENTICATED',
        detail: 'No active session cookie found.',
        instance: req.url,
        correlationId: (req as any).correlationId,
      });
    }

    const meData = await this.authService.getMe(token);
    return res.status(HttpStatus.OK).json(meData);
  }

  @Post('change-language')
  async changeLanguage(@Body() body: { locale: string }, @Req() req: Request) {
    const token = req.cookies?.gnext_session;
    const correlationId = (req as any).correlationId;
    return await this.authService.changeLanguage(token, body.locale, correlationId);
  }
}
