import { applyDecorators, SetMetadata } from '@nestjs/common';

export const REQUIRE_IDEMPOTENCY_KEY = 'requireIdempotency';
export const IDEMPOTENCY_KEY_OPTIONAL = 'idempotencyKeyOptional';

export interface IdempotencyOptions {
  /**
   * A request with no `Idempotency-Key` header runs as if the route had no decorator, instead of
   * being refused with `400 IDEMPOTENCY_KEY_REQUIRED`. For routes that clients other than the
   * register (the kiosk, Snappfood intake) also call and that send no key. A request that does send
   * one is protected as usual.
   */
  optional?: boolean;
}

/**
 * Makes a route safe to repeat (agent-protocol §19.11): the same `Idempotency-Key` with the same
 * body gets the first answer again, the same key with another body is `409 IDEMPOTENCY_CONFLICT`,
 * and the same key while the first request is still running is `409 IDEMPOTENCY_IN_PROGRESS`.
 * `scope` keeps one route's keys apart from another's, so one key may be used on several routes.
 */
export const RequireIdempotency = (scope?: string, options: IdempotencyOptions = {}) =>
  applyDecorators(
    SetMetadata(REQUIRE_IDEMPOTENCY_KEY, scope || 'DEFAULT'),
    SetMetadata(IDEMPOTENCY_KEY_OPTIONAL, !!options.optional),
  );
