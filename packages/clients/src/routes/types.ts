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

import { z } from 'zod';

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
  // Defense in depth: the brand is minted at the Discord interaction boundary
  // (`interaction.user.id`, always a non-empty snowflake); an empty string
  // would silently satisfy the cast and forward as a blank `X-User-Id`.
  if (id.length === 0) {
    throw new TypeError('asActor: id must be non-empty');
  }
  return id as ActorDiscordId;
}

/**
 * Smart constructor for `SubjectDiscordId`. Use only where the call site
 * genuinely operates on a different user than the actor.
 *
 * @param id The raw Discord snowflake of the target user
 */
export function asSubject(id: string): SubjectDiscordId {
  // Defense in depth — a stronger case than asActor: a subject id can arrive
  // from `?userId=` (user-controlled query string, see RouteDef.acceptsSubject),
  // so an empty value would silently mint a blank SubjectDiscordId.
  if (id.length === 0) {
    throw new TypeError('asSubject: id must be non-empty');
  }
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
   *
   * Two shapes accepted:
   *   - `Record<string, ZodTypeAny>` — the "spread" form, one entry per
   *     query param. Use this for ad-hoc per-route queries.
   *   - `ZodObject<TQuery>` — the "schema" form. Use this when you want
   *     to share a reusable query schema across routes (e.g., a shared
   *     pagination schema built with `z.object()`). The codegen
   *     unwraps to `.shape` internally so the two forms are equivalent
   *     at the wire level; the schema form lets you `.extend()` it with
   *     per-route fields without copying the record entries.
   */
  readonly query?: TQuery | z.ZodObject<TQuery>;
  /**
   * Zod schemas for request HEADERS. Each entry is one header name,
   * lowercased per HTTP convention (`'idempotency-key'`, not `'Idempotency-Key'`).
   * Generated client method emits these as required positional arguments
   * (or part of the options bag, depending on optionality). Server-side
   * the corresponding handler can `req.get(headerName)` and validate.
   *
   * Reserved for future use. The destructive memory batch operations
   * (`/memory/delete`, `/memory/purge`) achieve idempotency through the
   * preview-token / purge-token handshake instead — the token IS the
   * single-use replay key, so a separate `Idempotency-Key` header isn't
   * needed in the current design. This field stands ready for routes
   * outside the token-handshake pattern that still need header-driven
   * idempotency.
   */
  readonly headers?: Record<string, z.ZodTypeAny>;
  /**
   * Opt-in metadata that affects codegen behavior or documents semantic
   * intent. All fields optional; absence means "use defaults."
   *
   *   - `safeRead`: route uses POST for transport reasons (complex body
   *     that won't fit a query string) but is semantically read-only.
   *     Generated client treats it like a GET for cache purposes — e.g.,
   *     React Query wrappers use `useQuery` instead of `useMutation`.
   *     Without this flag, POST routes are assumed to be mutating.
   *
   *   - `softDeleteAware`: the resource supports soft delete. Future
   *     codegen can honor this to add `includeDeleted?: boolean` to list
   *     queries or warn when a caller fetches a soft-deleted entity. Set
   *     on the resource-level routes (list, get-by-id) that participate
   *     in the soft-delete cycle, not on the delete operation itself.
   *
   *   - `idempotent`: route is safe to retry without side effects beyond
   *     the first call. Replaying the SAME request lands the SAME 2xx
   *     response. Examples: PUT routes (HTTP convention), `setFocus`
   *     (state-set with same body). Retry layers reading this tag MAY
   *     auto-retry on network failure without surfacing an error.
   *
   *   - `atMostOnce`: route mutates AND is guarded by a single-use
   *     token (or similar at-most-once mechanism). Replaying the SAME
   *     request yields a 4xx token-expired error even though the
   *     original mutation succeeded server-side. The opposite of
   *     `idempotent` — a retry layer reading this tag must NOT
   *     auto-retry, because the spurious 4xx would surface a recoverable
   *     server-side success as a user-facing failure. Used by
   *     preview-token / purge-token destructive batch operations.
   *
   *   - Mutual-exclusivity invariants (enforced by manifest tests):
   *     `safeRead` and `idempotent` cannot both be true (a route either
   *     reads or writes-idempotently — never both). `safeRead` and
   *     `atMostOnce` cannot both be true (safeRead implies no mutation).
   *     `idempotent` and `atMostOnce` cannot both be true (literal
   *     opposites — idempotent retry is safe, atMostOnce retry isn't).
   */
  readonly meta?: {
    readonly safeRead?: boolean;
    readonly softDeleteAware?: boolean;
    readonly idempotent?: boolean;
    readonly atMostOnce?: boolean;
  };
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
  /**
   * Request timeout in milliseconds. When set, the generated client method
   * passes this to `callGateway`'s `timeoutMs`, overriding the method-aware
   * transport default: DEFERRED (10s) for reads, WRITE (20s) for writes.
   *
   * Reads default to DEFERRED because almost every read is invoked post-defer
   * (15-min window); the tight AUTOCOMPLETE budget (2.5s) is the DANGEROUS tier
   * and is opt-in only — register the id in `AUTOCOMPLETE_TIER` in
   * `manifest.test.ts`, for autocomplete-ONLY routes where a slower response is
   * useless. Omitting `timeoutMs` is now safe (it lands on DEFERRED/WRITE).
   *
   * Set an explicit value to: (a) widen a known-heavy op past the 10s read
   * default — `GATEWAY_TIMEOUTS.BULK_OPERATION` (30s) for batched/external work;
   * or (b) pin a known-slow read's tier so it isn't coupled to the default.
   *
   * Upper bound: a value above ~60s is a design smell, not a valid config —
   * a sync gateway request that needs more than a minute should be a BullMQ
   * job with push-based result delivery, not a blocking HTTP call. The
   * manifest invariant test caps timeoutMs at 60_000 to enforce this.
   */
  readonly timeoutMs?: number;
  /**
   * Worst-case internal timeout of any external-provider call this route's
   * handler makes — the SAME constant the handler passes to its
   * `AbortSignal.timeout`/`AbortController` (e.g. `VALIDATION_TIMEOUTS.API_KEY_VALIDATION`).
   *
   * Declaring it makes the cross-layer timeout invariant a tested contract term:
   * the manifest test asserts `timeoutMs >= externalCallBudgetMs + overhead`, so a
   * route that blocks on a slow third party can never be left with a CLIENT timeout
   * shorter than the work it triggers. That mismatch is the failure class where a slow
   * provider validation probe (e.g. a 30s key-save check) outruns a 10s client timeout
   * and the client aborts while the gateway is still succeeding.
   *
   * Omit for routes that only touch the DB / local work (the overwhelming majority).
   */
  readonly externalCallBudgetMs?: number;
}

/**
 * Type-erased route descriptor for use in maps and iteration.
 * The generic `RouteDef<…>` is the entry-declaration type; `AnyRouteDef`
 * is what code that walks the manifest works with.
 */
export type AnyRouteDef = RouteDef<z.ZodTypeAny | undefined, z.ZodTypeAny>;

/**
 * Resolve a `RouteDef.query` field to its `Record<string, ZodTypeAny>`
 * shape, regardless of whether the manifest entry passed a `Record<>` or
 * a `ZodObject` (the two accepted forms — see `RouteDef.query` JSDoc).
 *
 * Returns `undefined` if no query schema was declared. Used by:
 *   - the codegen (`method-builder.ts`) to iterate query param names
 *   - the cross-manifest invariant tests to walk every query field
 *   - any future tooling that wants a uniform query shape
 */
export function resolveQueryShape(
  query: AnyRouteDef['query']
): Record<string, z.ZodTypeAny> | undefined {
  if (query === undefined) {
    return undefined;
  }
  if (query instanceof z.ZodObject) {
    return query.shape;
  }
  return query;
}
