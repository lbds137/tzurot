/**
 * TtsConfigService typed errors
 *
 * Service-layer errors that the route layer translates into specific HTTP
 * error responses. Kept in a separate module so `TtsConfigService.ts` stays
 * focused on business logic + stays under the ESLint max-lines limit.
 */

/**
 * Thrown when {@link TtsConfigService.resolveNonCollidingName} walks its full
 * `MAX_CLONE_NAME_ATTEMPTS` budget without finding a free name. Pathological
 * case (user has ~20 copies of the same base name). The route translates this
 * to a `NAME_COLLISION` with a distinct message.
 */
export class TtsCloneNameExhaustedError extends Error {
  constructor(
    public readonly baseName: string,
    public readonly attempts: number
  ) {
    super(
      `Could not resolve a unique TTS clone name starting from "${baseName}" after ${attempts} attempts`
    );
    this.name = 'TtsCloneNameExhaustedError';
  }
}

/**
 * Thrown when a concurrent insert races past the `resolveNonCollidingName`
 * SELECT and claims the `effectiveName` before our INSERT lands. Carries the
 * bumped name so the caller can surface an accurate error message (the route
 * previously echoed `body.name`, which is wrong when the suffix was bumped).
 */
export class TtsAutoSuffixCollisionError extends Error {
  constructor(
    public readonly effectiveName: string,
    cause: unknown
  ) {
    super(
      `TTS config name "${effectiveName}" was taken by a concurrent request after suffix resolution`,
      { cause }
    );
    this.name = 'TtsAutoSuffixCollisionError';
  }
}

/**
 * Thrown when `update()` receives a syntactically valid string for `provider`
 * (per the loose `optionalString(40)` schema) that is not a known
 * `TtsProviderId`. The route translates this to a `VALIDATION_ERROR`.
 *
 * Why this lives at the service layer: `TtsConfigUpdateSchema` intentionally
 * uses `optionalString(40)` rather than `TtsProviderIdSchema` so empty-string
 * "preserve existing value" semantics work for the dashboard form. The
 * strict-set check therefore must happen *after* the merge with the existing
 * row but *before* the Prisma write — that's exactly inside `update()`.
 */
export class TtsInvalidProviderError extends Error {
  constructor(public readonly provider: string) {
    super(
      `provider "${provider}" is not a known TtsProviderId — must be one of 'self-hosted', 'elevenlabs', 'mistral'`
    );
    this.name = 'TtsInvalidProviderError';
  }
}
