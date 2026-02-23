/**
 * Shapes.inc Error Types
 *
 * Job handlers (ShapesImportJob, ShapesExportJob) use a blacklist approach:
 * only ShapesAuthError, ShapesNotFoundError, and ShapesFetchError are
 * non-retryable. Everything else — including ShapesRateLimitError (429),
 * ShapesServerError (5xx), network timeouts, and unexpected exceptions —
 * is retried by BullMQ via the default path.
 *
 * At the per-request level (ShapesDataFetcher.makeRequest), ShapesRateLimitError
 * and ShapesServerError are also retried with exponential backoff before
 * propagating to the job handler.
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
