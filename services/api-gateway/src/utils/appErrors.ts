/**
 * Application-level error classes that the HTTP layer (`asyncHandler`) translates
 * into specific status codes. Throwing one of these from a service or handler lets
 * the generic `asyncHandler` map it once, instead of every route re-implementing
 * the same status/body shape.
 */

/**
 * A requested resource doesn't exist. `asyncHandler` maps this to a 404 whose body
 * is a clean `<resource> not found` — the optional `logMessage` carries richer
 * context (ids, the operation) for server-side logs WITHOUT leaking it to the client.
 *
 * Use for the narrow race where a resource passes a route's existence pre-check but
 * is deleted before a follow-up read: the correct status is 404 (client-caused), not
 * 500 (server fault), and the internal operation string must not reach the response.
 */
export class NotFoundError extends Error {
  constructor(
    /** Public, body-safe label, e.g. `'LLM config'` → `"LLM config not found"`. */
    public readonly resource: string,
    /** Optional richer message for logs; defaults to `<resource> not found`. */
    logMessage?: string
  ) {
    super(logMessage ?? `${resource} not found`);
    this.name = 'NotFoundError';
  }
}
