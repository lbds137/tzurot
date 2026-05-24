/**
 * Route manifest types: foundation for the typed API surface between bot-client
 * and api-gateway.
 *
 * The manifest is a declarative source of truth — each route is described as
 * plain data (audience, method, path, schemas), and codegen produces both the
 * server-side Express mounts and the client-side typed methods from it.
 *
 * The branded `ActorDiscordId` / `SubjectDiscordId` types make the
 * actor-vs-subject distinction a compile-time constraint: the bot owner
 * inspecting a different user's diagnostic logs has TWO distinct identities
 * to express, and passing the wrong one becomes a type error rather than a
 * runtime 401 or a silent data leak.
 */

import type { z } from 'zod';

/**
 * Discord ID of the human (or service principal) initiating the request.
 * Forwarded to api-gateway as `X-User-Id`. For service-to-service calls
 * with no human actor, use `ServiceClient` which doesn't accept an actor.
 *
 * Mint via `asActor(id)` at the boundary where a Discord interaction enters
 * the system. The brand prevents accidental swapping with `SubjectDiscordId`.
 */
declare const ActorBrand: unique symbol;
export type ActorDiscordId = string & { readonly [ActorBrand]: true };

/**
 * Discord ID of the user being acted UPON, distinct from the actor.
 * Examples: bot owner (actor) blocks user (subject) via /admin/denylist;
 * bot owner (actor) inspects user (subject) diagnostic logs via
 * /admin/diagnostic/recent?userId=<subject>.
 *
 * Mint via `asSubject(id)` ONLY where you genuinely have a target user
 * distinct from the caller. The brand prevents passing an actor where a
 * subject is expected (and vice versa).
 */
declare const SubjectBrand: unique symbol;
export type SubjectDiscordId = string & { readonly [SubjectBrand]: true };

/**
 * Smart constructor for `ActorDiscordId`. The cast is the only legal way to
 * mint a brand — `string` doesn't structurally satisfy the brand intersection.
 *
 * @param id The raw Discord snowflake (e.g., `interaction.user.id`)
 */
export function asActor(id: string): ActorDiscordId {
  return id as ActorDiscordId;
}

/**
 * Smart constructor for `SubjectDiscordId`. Use only where the call site
 * genuinely operates on a different user than the actor.
 *
 * @param id The raw Discord snowflake of the target user
 */
export function asSubject(id: string): SubjectDiscordId {
  return id as SubjectDiscordId;
}

/**
 * Audience classifies a route's auth/access model:
 *  - `internal`: service-to-service only. No human actor. Validated by
 *    `requireServiceAuth` at the prefix mount. Bot-client invokes via
 *    `ServiceClient`.
 *  - `admin`: bot-owner only. Validated by `requireOwnerAuth` at the prefix
 *    mount. Bot-client invokes via `OwnerClient(actor)`.
 *  - `user`: any authenticated Discord user. Validated by `requireUserAuth`
 *    at the prefix mount. Bot-client invokes via `UserClient(actor)`.
 */
export type Audience = 'internal' | 'admin' | 'user';

/**
 * HTTP methods used by the route manifest. Lowercase to match Express's API.
 */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Declarative route descriptor. Manifest entries are plain data — no Express,
 * no handler references. This keeps `@tzurot/common-types` free of Express as
 * a dependency and lets the manifest be imported by:
 *   - the codegen tool (Node, no Express)
 *   - the client clients (browser-safe transport)
 *   - the server mounts (Express target)
 *
 * Handlers live in their respective service route files; codegen wires them
 * up by `id` at mount time.
 *
 * Generic params preserve literal types for `as const satisfies` declarations,
 * so generated client method signatures can infer `z.infer<typeof route.output>`
 * without losing type information.
 */
export interface RouteDef<
  TInput extends z.ZodTypeAny | undefined = z.ZodTypeAny | undefined,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
  TParams extends Record<string, z.ZodTypeAny> = Record<string, z.ZodTypeAny>,
  TQuery extends Record<string, z.ZodTypeAny> = Record<string, z.ZodTypeAny>,
> {
  /** Route audience — drives prefix mount, client class, and auth middleware. */
  readonly audience: Audience;
  /** HTTP method, lowercase to match Express. */
  readonly method: HttpMethod;
  /**
   * Path WITHOUT prefix. Express style:
   * `/diagnostic/:requestId/response-ids`. Codegen prepends `/api/{audience}`.
   */
  readonly path: string;
  /**
   * Stable identifier used as:
   *   - generated client method name
   *   - server-side handler-registry key
   *   - dedup key in invariant tests
   * Convention: camelCase verb + noun (e.g., `getRecentDiagnostics`,
   * `updateResponseIds`, `listLlmConfigs`).
   *
   * MUST match the containing object's key in the audience-manifest
   * record (e.g., `internalRoutes.aiGenerate.id === 'aiGenerate'`).
   * The redundancy is load-bearing because generated client code
   * dereferences `ROUTE_MANIFEST.${id}` where the object key is not
   * available. The per-audience invariant tests enforce equality so
   * the two cannot drift.
   */
  readonly id: string;
  /**
   * Zod schema for request body. Omit for GET / DELETE with no body.
   */
  readonly input?: TInput;
  /**
   * Zod schema for response body. Required so generated clients have
   * runtime validation + correct return-type inference.
   */
  readonly output: TOutput;
  /**
   * Zod schemas for `:path` params, keyed by param name. Must match the
   * `:names` in `path` exactly (enforced by per-audience invariant tests).
   *
   * Server-side validation only — the generated client method extracts
   * param NAMES from `path` and emits them as `string` positional
   * parameters; the Zod schemas declared here are consulted by the
   * route handler, not the client signature. A future enhancement could
   * specialize `buildMethod` to narrow the client signature based on the
   * param schema (e.g., `z.string().uuid()` → branded `Uuid` parameter),
   * but the wire-level reality (URL path segments are always strings)
   * means the client-side benefit is limited.
   */
  readonly params?: TParams;
  /**
   * Zod schemas for `?query` params, keyed by param name.
   *
   * The generated client method signature widens every query param to
   * `string?` because all HTTP query values are strings on the wire.
   * Numeric / boolean / coerce schemas declared here are validated
   * server-side by the route handler, not in the generated client
   * signature — a caller passing `'yesterday'` for a numeric query
   * gets a runtime 400 from the gateway, not a compile-time error.
   * If a numeric query needs compile-time narrowing on the client
   * side, a follow-up could specialize `buildOptionsType` to inspect
   * the Zod schema kind.
   */
  readonly query?: TQuery;
  /**
   * If true, this route operates on a subject distinct from the actor.
   * Generated client method gains `subject?: SubjectDiscordId` parameter.
   *
   * Wire convention: the generated client emits the subject as
   * `?userId=<value>` in the query string. The api-gateway handler MUST
   * read from `req.query.userId` — there is no other supported param
   * name. The cross-manifest invariant test additionally forbids
   * `acceptsSubject: true` AND `query.userId` on the same route (would
   * generate two `?userId=` entries, second silently overwriting first).
   *
   * Two contexts in the current manifest:
   *   - admin routes (denylist add): bot owner blocks a subject user.
   *   - user routes (diagnostic GETs lifted from /admin per the route-
   *     prefix cutover): non-owner sees only their own logs; bot owner
   *     can pass `subject` to inspect another user's logs.
   *
   * Only valid on `admin` or `user` audiences — manifest invariant test
   * enforces (`internal` audience has no human actor and so no subject).
   */
  readonly acceptsSubject?: boolean;
  /**
   * If true, this route has no human actor — pure service-to-service.
   * Generated `ServiceClient` method omits the actor parameter entirely.
   * Only valid on `internal` audience routes — manifest invariant test
   * enforces.
   */
  readonly serviceOnly?: boolean;
  /**
   * If true, the route handler depends on `req.provisionedUserId` (an
   * internal UUID derived from the Discord ID via UserService). The
   * generated server mount adds `requireProvisionedUser(prisma)` after
   * the prefix-level `requireUserAuth`. Only meaningful on `user` audience
   * routes — manifest invariant test enforces.
   */
  readonly requiresProvisionedUser?: boolean;
}

/**
 * Type-erased route descriptor for use in maps and iteration.
 * The generic `RouteDef<…>` is the entry-declaration type; `AnyRouteDef`
 * is what code that walks the manifest works with.
 */
export type AnyRouteDef = RouteDef<z.ZodTypeAny | undefined, z.ZodTypeAny>;
