/**
 * Conformance-harness fixture types.
 *
 * Every route in the manifest gets exactly one `ConformanceEntry` in the
 * registry: either a `RouteFixture` that drives the real handler to its
 * success path (so the response body can be parsed through the route's
 * declared `output` schema), or a `RouteSkip` with a written reason why the
 * success path can't be exercised in the harness (external API round-trip,
 * queue-worker dependency, etc.).
 *
 * The registry's completeness is enforced by `registry.test.ts`, which
 * asserts an exact key bijection with ROUTE_MANIFEST (missing entries fail,
 * stale entries fail, empty skip reasons fail). A `satisfies
 * Record<RouteId, ...>` compile-time gate was considered and rejected: the
 * per-family fixture records are annotated `Record<string, ConformanceEntry>`
 * (keys erased), so the satisfies check would pass vacuously via the string
 * index signature — the runtime bijection is the stronger guarantee.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';

/** HTTP methods the harness can replay (mirrors the manifest's HttpMethod). */
export type HarnessMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface SeedContext {
  /** PGLite-backed Prisma client shared with the mounted app. */
  prisma: PrismaClient;
  /** Discord snowflake of the authenticated actor (also configured as bot owner). */
  actorDiscordId: string;
  /** Internal `users.id` UUID of the provisioned actor. */
  actorUserId: string;
  /** `users.default_persona_id` UUID of the provisioned actor. */
  actorPersonaId: string;
  /**
   * Fire an authenticated request against the harness app and return the
   * parsed JSON body. Throws on non-2xx so a broken seed fails loudly
   * instead of cascading into a confusing route-level failure.
   *
   * This lets fixtures seed through the API itself — e.g. create a
   * personality via `POST /api/user/personality` — instead of hand-writing
   * Prisma inserts that drift from the real creation path.
   */
  call: (method: HarnessMethod, url: string, body?: unknown) => Promise<unknown>;
}

/**
 * Request pieces a seed can compute from created rows (e.g. the UUID of an
 * API-created persona). Merged over the fixture's static fields by the runner.
 */
export interface SeedOverrides {
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

export interface RouteFixture {
  /**
   * Seed the DB/state the route needs to reach its success path. May return
   * overrides for request pieces that depend on seeded ids.
   */
  seed?: (ctx: SeedContext) => Promise<SeedOverrides | undefined | void>;
  /** Values for the `:params` in the route path. */
  params?: Record<string, string>;
  /** JSON request body for POST/PUT/PATCH routes. */
  body?: unknown;
  /** Query-string entries. */
  query?: Record<string, string>;
  /** Exact expected success status. Default: assert any 2xx. */
  status?: number;
}

export interface RouteSkip {
  /** Why this route's success path can't be driven in the harness. */
  skip: string;
}

export type ConformanceEntry = RouteFixture | RouteSkip;

export function isSkip(entry: ConformanceEntry): entry is RouteSkip {
  return 'skip' in entry;
}
