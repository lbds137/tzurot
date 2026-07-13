/**
 * Shapes.inc Error Types
 *
 * Two-tier retry system:
 *
 * **Tier 1 — Per-request (ShapesDataFetcher.makeRequest):**
 * ShapesRateLimitError (429), ShapesServerError (5xx), AbortError (timeout),
 * and fetch TypeError (network failure) are retried up to 3 total attempts
 * with exponential backoff. This prevents a single transient failure from
 * restarting the entire BullMQ job.
 *
 * **Tier 2 — Per-job (BullMQ via ShapesExportJob/ShapesImportJob):**
 * If all per-request retries are exhausted, the error propagates to the job
 * handler. Only ShapesAuthError, ShapesNotFoundError, ShapesFetchError, and
 * ShapesBotProtectionError are non-retryable (immediate failure). Everything
 * else — including ShapesRateLimitError and ShapesServerError that survived
 * per-request retries — triggers a BullMQ job-level retry (restarts from
 * page 1). ShapesFetchBusyError is deliberately in the retryable bucket:
 * BullMQ's exponential backoff IS the wait for a free concurrency slot.
 */

export class ShapesAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShapesAuthError';
  }
}

export class ShapesNotFoundError extends Error {
  constructor(resource: string) {
    super(`Not found: ${resource}`);
    this.name = 'ShapesNotFoundError';
  }
}

export class ShapesRateLimitError extends Error {
  constructor() {
    super('Rate limited by shapes.inc');
    this.name = 'ShapesRateLimitError';
  }
}

export class ShapesServerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ShapesServerError';
    this.status = status;
  }
}

export class ShapesFetchError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ShapesFetchError';
    this.status = status;
  }
}

/**
 * shapes.inc appears to have put bot-detection middleware in front of the
 * API (Cloudflare mitigation, PerimeterX, Datadome, or an HTML block page on
 * a JSON endpoint). Distinct from ShapesAuthError so the failure mode is
 * obvious instead of surfacing as a confusing 403 or an HTML-as-JSON parse
 * error — the day this starts firing is the day the session-cookie fetch
 * path needs a human decision, so it must never be masked by retries.
 */
export class ShapesBotProtectionError extends Error {
  constructor(signal: string) {
    super(
      `shapes.inc appears to have added bot-detection middleware (${signal}); ` +
        'the session-cookie fetch path may no longer be viable. Retrying will not help — ' +
        'this needs investigation.'
    );
    this.name = 'ShapesBotProtectionError';
  }
}

/**
 * The global shapes.inc fetch-concurrency gate is at capacity (see
 * shapesFetchGate.ts). Thrown BEFORE any fetching starts, so the job-level
 * retry it triggers costs nothing — BullMQ's exponential backoff is the wait
 * for a slot. Deliberately retryable at the job tier.
 */
export class ShapesFetchBusyError extends Error {
  constructor(maxConcurrent: number) {
    super(
      `Too many simultaneous shapes.inc fetches (cap ${maxConcurrent}) — ` +
        'the job will retry automatically once a slot frees up.'
    );
    this.name = 'ShapesFetchBusyError';
  }
}
