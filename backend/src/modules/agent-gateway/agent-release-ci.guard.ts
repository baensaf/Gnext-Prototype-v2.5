import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { Public } from '../../common/decorators/public.decorator';

/** Shorter than this is a placeholder, not a secret; the route stays off. */
export const MIN_CI_TOKEN_LENGTH = 32;

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

/**
 * Lets the CI pipeline in by the shared secret in AGENT_RELEASE_CI_TOKEN (the same value is the
 * AGENT_RELEASE_TOKEN repository secret). Without the variable the route answers 503, so a
 * server nobody configured for CI accepts no builds at all. The request carries no user and no
 * tenant: all it can do is add an unpublished release.
 */
@Injectable()
export class AgentReleaseCiGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.AGENT_RELEASE_CI_TOKEN?.trim() || '';
    if (expected.length < MIN_CI_TOKEN_LENGTH) {
      throw new ServiceUnavailableException({
        code: 'CI_UPLOAD_OFF',
        title: 'CI uploads are off',
        detail: `Set AGENT_RELEASE_CI_TOKEN (at least ${MIN_CI_TOKEN_LENGTH} characters) on the server to accept builds from CI.`,
      });
    }
    const header = context.switchToHttp().getRequest().headers?.authorization;
    const presented = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    // Comparing digests keeps the comparison constant-time whatever the lengths.
    if (!presented || !timingSafeEqual(digest(presented), digest(expected))) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', title: 'Unauthorized', detail: 'Invalid CI token.' });
    }
    return true;
  }
}

/** `Public` takes the route out of the session and CSRF guards; the CI token replaces them. */
export const AgentReleaseCiAuthenticated = () => applyDecorators(Public(), UseGuards(AgentReleaseCiGuard));
