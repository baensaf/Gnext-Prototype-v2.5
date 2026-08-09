import { SetMetadata } from '@nestjs/common';

export const REQUIRE_IDEMPOTENCY_KEY = 'requireIdempotency';
export const RequireIdempotency = (scope?: string) =>
  SetMetadata(REQUIRE_IDEMPOTENCY_KEY, scope || 'DEFAULT');
