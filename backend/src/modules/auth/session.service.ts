import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '../../entities/Session.entity';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(Session)
    private readonly sessionRepo: Repository<Session>,
  ) {}

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  generateCsrfToken(): string {
    return randomBytes(32).toString('hex');
  }

  async createSession(userId: string, ip?: string, userAgent?: string): Promise<{ session: Session; rawToken: string; rawCsrfToken: string }> {
    const rawToken = this.generateToken();
    const rawCsrfToken = this.generateCsrfToken();
    const tokenHash = this.hashToken(rawToken);
    const csrfHash = this.hashToken(rawCsrfToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days session

    const session = this.sessionRepo.create({
      user_id: userId,
      token_hash: tokenHash,
      csrf_hash: csrfHash,
      expires_at: expiresAt,
      ip: ip || null,
      user_agent: userAgent || null,
    });

    const savedSession = await this.sessionRepo.save(session);
    return { session: savedSession, rawToken, rawCsrfToken };
  }

  async findValidSession(rawToken: string): Promise<Session | null> {
    if (!rawToken) return null;
    const tokenHash = this.hashToken(rawToken);
    const session = await this.sessionRepo.findOne({ where: { token_hash: tokenHash } });

    if (!session) return null;
    if (session.revoked_at) return null;
    if (new Date() > new Date(session.expires_at)) return null;

    // Update last_seen_at
    session.last_seen_at = new Date();
    await this.sessionRepo.save(session);

    return session;
  }

  validateCsrfToken(session: Session, rawCsrfToken: string): boolean {
    if (!rawCsrfToken || !session || !session.csrf_hash) return false;
    const computedHash = this.hashToken(rawCsrfToken);
    return computedHash === session.csrf_hash;
  }

  async revokeSession(rawToken: string): Promise<void> {
    if (!rawToken) return;
    const tokenHash = this.hashToken(rawToken);
    const session = await this.sessionRepo.findOne({ where: { token_hash: tokenHash } });
    if (session) {
      session.revoked_at = new Date();
      await this.sessionRepo.save(session);
    }
  }
}
