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
 * handler. Only ShapesAuthError, ShapesNotFoundError, and ShapesFetchError
 * are non-retryable (immediate failure). Everything else — including
 * ShapesRateLimitError and ShapesServerError that survived per-request
 * retries — triggers a BullMQ job-level retry (restarts from page 1).
 */

export class ShapesAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShapesAuthError';
  }
}

export class ShapesNotFoundError extends Error {
  constructor(slug: string) {
    super(`Shape not found: ${slug}`);
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
