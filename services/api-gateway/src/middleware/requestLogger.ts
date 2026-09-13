/**
 * Request Logger Middleware
 *
 * Wraps pino-http with serializers that sanitize the serialized request and
 * response before either is logged.
 *
 * The serializers are where the redaction has to happen: pino-http attaches
 * the request as a pino CHILD BINDING, which bypasses the parent logger's
 * `formatters.log` sanitization entirely, and it overrides the parent's own
 * `req`/`res` serializers. `wrapSerializers` (pino-http's default) runs the
 * standard serializers first and hands these functions the already-serialized
 * plain objects, so `sanitizeObject` applies to them directly.
 *
 * The response direction rides the same call for free. It is defence in depth
 * rather than an active redaction: the serialized `res` on this path holds
 * only `statusCode`, so there is no response header to redact today. If one
 * ever appears, the arm redacts it when its exact lowercase name is in the
 * sensitive set and its value is a string or an array of strings. Both
 * directions are pinned by `requestLogger.test.ts`.
 */
import { createRequire } from 'module';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { createSanitizedSerializers } from '@tzurot/common-types/utils/logSanitizer';

// Import pino-http (CommonJS) via require
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- pino-http is CommonJS-only and lacks ESM type definitions. require() returns 'any' type unavoidably.
const pinoHttp = require('pino-http');

/**
 * Build the HTTP request-logging middleware for the given logger.
 */
export function createRequestLogger(logger: Logger): RequestHandler {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- pino-http is imported via CommonJS require() and has 'any' type. Functionally correct, just lacks type definitions.
  return pinoHttp({
    logger,
    serializers: createSanitizedSerializers(),
  });
}
