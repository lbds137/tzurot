/**
 * LlmConfigService typed errors
 *
 * Service-layer errors that the route layer translates into specific HTTP
 * error responses. Kept in a separate module so `LlmConfigService.ts` stays
 * focused on business logic + stays under the ESLint max-lines limit.
 */

/**
 * Thrown when {@link LlmConfigService.resolveNonCollidingName} walks its full
 * `MAX_CLONE_NAME_ATTEMPTS` budget without finding a free name. Pathological
 * case (user has ~20 copies of the same base name). The route translates this
 * to a `NAME_COLLISION` with a distinct message so the client sees an
 * actionable error instead of an opaque 500.
 */
export class CloneNameExhaustedError extends Error {
  constructor(
    public readonly baseName: string,
    public readonly attempts: number
  ) {
    super(
      `Could not resolve a unique clone name starting from "${baseName}" after ${attempts} attempts`
    );
    this.name = 'CloneNameExhaustedError';
  }
}

/**
 * Thrown when a concurrent insert races past the `resolveNonCollidingName`
 * SELECT and claims the `effectiveName` before our INSERT lands. Carries the
 * bumped name so the caller can surface an accurate error message (the route
 * previously echoed `body.name`, which is wrong when the suffix was bumped).
 *
 * The underlying Prisma P2002 is chained via the ES2022 `cause` option so
 * structured loggers and error aggregators (Sentry, etc.) pick it up through
 * the standard `error.cause` chain rather than a custom property.
 */
export class AutoSuffixCollisionError extends Error {
  constructor(
    public readonly effectiveName: string,
    cause: unknown
  ) {
    super(`Name "${effectiveName}" was taken by a concurrent request after suffix resolution`, {
      cause,
    });
    this.name = 'AutoSuffixCollisionError';
  }
}
