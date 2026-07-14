/**
 * Admin route manifest — bot-owner-only endpoints.
 *
 * Mounted at `/api/admin/*` after the route-prefix cutover (currently the
 * legacy URLs at `/admin/*` still serve). The generated `OwnerClient`
 * requires `actor: ActorDiscordId` on every method.
 *
 * Audience invariant: every entry below has `audience: 'admin'`. Subject
 * parameters (acceptsSubject: true) are allowed on routes where the bot
 * owner operates on a different user's data (e.g., denylist add: owner
 * blocks subject).
 *
 * Notably NOT in this manifest (reclassified to internal):
 *   - PATCH /diagnostic/:requestId/response-ids (service-to-service)
 *   - GET /denylist/cache (service-to-service bulk hydration)
 *
 * And NOT in this manifest (reclassified to user with acceptsSubject):
 *   - GET /diagnostic/recent, /by-message/:id, /by-response/:id, /:requestId
 *     The route-prefix cutover lifts these to user-audience — the server
 *     filters by caller userId for non-owners (each user sees only their
 *     own logs); bot owner can pass a subject param to view another user's
 *     logs. The actor/subject distinction surfaces in the userClient
 *     method signature.
 */

import { z } from 'zod';
import { MODEL_SLOTS } from '@tzurot/common-types/constants/ai';
import { GATEWAY_TIMEOUTS } from '@tzurot/common-types/constants/discord';
import { DbSyncSchema, InvalidateCacheSchema } from '@tzurot/common-types/schemas/api/admin';
import {
  BroadcastInputSchema,
  BroadcastResponseSchema,
} from '@tzurot/common-types/schemas/api/broadcast';
import {
  AdminCleanupResponseSchema,
  DbSyncResponseSchema,
  InvalidateCacheResponseSchema,
} from '@tzurot/common-types/schemas/api/admin-operations';
import { AdminSettingsSchema } from '@tzurot/common-types/schemas/api/adminSettings';
import { ConfigOverridesSchema } from '@tzurot/common-types/schemas/api/configOverrides';
import {
  GetSystemSettingsResponseSchema,
  UpdateSystemSettingsRequestSchema,
  UpdateSystemSettingsResponseSchema,
} from '@tzurot/common-types/schemas/api/systemSettings';
import {
  AddDenylistResponseSchema,
  DenylistAddSchema,
  denylistEntityTypeSchema,
  denylistScopeSchema,
  ListDenylistResponseSchema,
  RemoveDenylistResponseSchema,
} from '@tzurot/common-types/schemas/api/denylist';
import {
  CreateLlmConfigResponseSchema,
  DeleteLlmConfigResponseSchema,
  GetLlmConfigResponseSchema,
  ListLlmConfigsResponseSchema,
  LlmConfigCreateSchema,
  LlmConfigUpdateSchema,
  SetDefaultLlmConfigResponseSchema,
  UpdateLlmConfigResponseSchema,
} from '@tzurot/common-types/schemas/api/llm-config';
import {
  AdminPersonalityResponseSchema,
  PersonalityCreateSchema,
  PersonalityUpdateSchema,
} from '@tzurot/common-types/schemas/api/personality';
import {
  CreateTtsConfigResponseSchema,
  DeleteTtsConfigResponseSchema,
  GetTtsConfigResponseSchema,
  ListTtsConfigsResponseSchema,
  SetDefaultTtsConfigResponseSchema,
  TtsConfigCreateSchema,
  TtsConfigUpdateSchema,
  UpdateTtsConfigResponseSchema,
} from '@tzurot/common-types/schemas/api/tts-config';
import { AdminUsageStatsSchema } from '@tzurot/common-types/schemas/api/usage';
import type { RouteDef } from './types.js';

// Shared path constants — extracted because GET/PUT/DELETE on the same
// resource :id share the path literal three ways (CRUD detail endpoints).
const LLM_CONFIG_DETAIL_PATH = '/llm-config/:id';
const TTS_CONFIG_DETAIL_PATH = '/tts-config/:id';

/**
 * Admin route registry. Each entry is `as const satisfies RouteDef` so the
 * codegen generator can read literal types for id, method, path.
 *
 * Naming convention for IDs: `<verb><Resource>` (e.g., `createPersonality`,
 * `setLlmConfigDefault`). Owner-only — the generated client class is
 * `OwnerClient` with required `actor: ActorDiscordId`.
 */
export const adminRoutes = {
  // ============================================================================
  // Operational maintenance
  // ============================================================================

  /**
   * POST /api/admin/db-sync — Bidirectional dev↔prod data sync.
   *
   * LONG_SYNC tier (see the timeoutMs field below) — duration scales with
   * table size, so this route outgrew the write-tier budgets.
   */
  dbSync: {
    audience: 'admin',
    method: 'post',
    path: '/db-sync',
    id: 'dbSync',
    input: DbSyncSchema,
    output: DbSyncResponseSchema,
    // db-sync scans every table + flushes writes, so its duration scales
    // with data: a fact-carrying sync outgrew BULK_OPERATION (succeeded
    // server-side after the client aborted). LONG_SYNC covers the realistic
    // horizon; past ~2 min observed, the filed async-job refactor takes over
    // (backlog/cold/follow-ups.md) — do not raise this again.
    timeoutMs: GATEWAY_TIMEOUTS.LONG_SYNC,
  },

  /**
   * POST /api/admin/cleanup — Purge orphan history rows + tombstones.
   *
   * Slow route — duration is data-dependent: the retention sweep loops
   * unbounded over aged rows, so large purges scale past tens of seconds.
   * Same data-scaled class as db-sync — shares LONG_SYNC and the same
   * filed async-job escape hatch.
   */
  broadcast: {
    audience: 'admin',
    method: 'post',
    path: '/broadcast',
    id: 'broadcast',
    input: BroadcastInputSchema,
    output: BroadcastResponseSchema,
    // No explicit timeout: inherits the WRITE floor. Resolution + row
    // creation + enqueue are quick; the DM sending happens async in the worker.
  },

  cleanup: {
    audience: 'admin',
    method: 'post',
    path: '/cleanup',
    id: 'cleanup',
    timeoutMs: GATEWAY_TIMEOUTS.LONG_SYNC,
    // Inline schema (not extracted to schemas/api/) because the shape is
    // route-local and there's no second consumer; extracting would add
    // an indirection without buying reusability.
    input: z.object({
      target: z.enum(['history', 'tombstones', 'all']).default('all'),
      daysToKeep: z.number().int().positive().optional(),
    }),
    output: AdminCleanupResponseSchema,
  },

  /** POST /api/admin/invalidate-cache — Single-personality or bot-wide cache flush. */
  invalidateCache: {
    audience: 'admin',
    method: 'post',
    path: '/invalidate-cache',
    id: 'invalidateCache',
    input: InvalidateCacheSchema,
    output: InvalidateCacheResponseSchema,
  },

  // ============================================================================
  // Personality management (admin-side: create / update)
  // The bulk of personality CRUD lives in the user manifest (users own
  // personalities); the admin endpoints below are for bot-owner-created
  // global personalities and emergency overrides.
  // ============================================================================

  /** POST /api/admin/personality — Create a global / admin-owned personality. */
  createGlobalPersonality: {
    audience: 'admin',
    method: 'post',
    path: '/personality',
    id: 'createGlobalPersonality',
    input: PersonalityCreateSchema,
    // Admin create/update both emit the slim admin envelope (subset of
    // fields + metadata), not the full user-route personality detail. (The
    // CreatePersonalityResponseSchema this entry used to declare belongs to
    // the user-audience create route.)
    output: AdminPersonalityResponseSchema,
  },

  /** PATCH /api/admin/personality/:slug — Admin-side personality update. */
  updateGlobalPersonality: {
    audience: 'admin',
    method: 'patch',
    path: '/personality/:slug',
    id: 'updateGlobalPersonality',
    params: { slug: z.string() },
    input: PersonalityUpdateSchema,
    output: AdminPersonalityResponseSchema,
  },

  // ============================================================================
  // Denylist (subject-aware: admin blocks specific user/guild)
  // ============================================================================

  /**
   * POST /api/admin/denylist — Block a USER (subject) or GUILD.
   * The `subject` arrives via the request body (`discordId` field), not as
   * a separate manifest-level subject param — the input schema already
   * carries the target identity. acceptsSubject: false at the manifest level.
   */
  addDenylistEntry: {
    audience: 'admin',
    method: 'post',
    path: '/denylist',
    id: 'addDenylistEntry',
    input: DenylistAddSchema,
    output: AddDenylistResponseSchema,
  },

  /**
   * GET /api/admin/denylist — List entries with optional ?type= filter.
   */
  listDenylistEntries: {
    audience: 'admin',
    method: 'get',
    path: '/denylist',
    id: 'listDenylistEntries',
    query: { type: denylistEntityTypeSchema.optional() },
    output: ListDenylistResponseSchema,
    meta: { safeRead: true },
  },

  /**
   * DELETE /api/admin/denylist/:type/:discordId/:scope/:scopeId — Remove entry.
   */
  removeDenylistEntry: {
    audience: 'admin',
    method: 'delete',
    path: '/denylist/:type/:discordId/:scope/:scopeId',
    id: 'removeDenylistEntry',
    params: {
      type: denylistEntityTypeSchema,
      discordId: z.string(),
      scope: denylistScopeSchema,
      scopeId: z.string(),
    },
    output: RemoveDenylistResponseSchema,
  },

  // ============================================================================
  // LLM config (global) — bot-owner manages the global pool of presets
  // ============================================================================

  /** GET /api/admin/llm-config — List all global configs. */
  listGlobalLlmConfigs: {
    audience: 'admin',
    method: 'get',
    path: '/llm-config',
    id: 'listGlobalLlmConfigs',
    output: ListLlmConfigsResponseSchema,
    meta: { safeRead: true },
    // Dual-context: bot-owner autocomplete (3s Discord deadline) and
    // bot-owner dashboard refresh (post-defer). DEFERRED wins because the
    // dashboard path needs the longer budget; the autocomplete caller already
    // caches results, so the rare cold-path call tolerating a slow gateway is
    // an acceptable trade for not splitting this into two routes.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  /** GET /api/admin/llm-config/:id — Fetch one global config. */
  getGlobalLlmConfig: {
    audience: 'admin',
    method: 'get',
    path: LLM_CONFIG_DETAIL_PATH,
    id: 'getGlobalLlmConfig',
    params: { id: z.string() },
    output: GetLlmConfigResponseSchema,
    meta: { safeRead: true },
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  /** POST /api/admin/llm-config — Create a new global config. */
  createGlobalLlmConfig: {
    audience: 'admin',
    method: 'post',
    path: '/llm-config',
    id: 'createGlobalLlmConfig',
    input: LlmConfigCreateSchema,
    output: CreateLlmConfigResponseSchema,
  },

  /** PUT /api/admin/llm-config/:id — Update an existing global config. */
  updateGlobalLlmConfig: {
    audience: 'admin',
    method: 'put',
    path: LLM_CONFIG_DETAIL_PATH,
    id: 'updateGlobalLlmConfig',
    params: { id: z.string() },
    input: LlmConfigUpdateSchema,
    output: UpdateLlmConfigResponseSchema,
    meta: { idempotent: true },
    timeoutMs: GATEWAY_TIMEOUTS.WRITE,
  },

  /** PUT /api/admin/llm-config/:id/set-default — Promote to paid default. */
  setGlobalLlmConfigDefault: {
    audience: 'admin',
    method: 'put',
    path: '/llm-config/:id/set-default',
    id: 'setGlobalLlmConfigDefault',
    params: { id: z.string() },
    // Which default slot the config is promoted into; the gateway
    // capability-gates the vision slot.
    query: { slot: z.enum(MODEL_SLOTS).optional() },
    output: SetDefaultLlmConfigResponseSchema,
    meta: { idempotent: true },
  },

  /** PUT /api/admin/llm-config/:id/set-free-default — Promote to free-tier default. */
  setGlobalLlmConfigFreeDefault: {
    audience: 'admin',
    method: 'put',
    path: '/llm-config/:id/set-free-default',
    id: 'setGlobalLlmConfigFreeDefault',
    params: { id: z.string() },
    // Which free-default slot the config is promoted into; the gateway
    // capability-gates the vision slot.
    query: { slot: z.enum(MODEL_SLOTS).optional() },
    output: SetDefaultLlmConfigResponseSchema,
    meta: { idempotent: true },
  },

  /** DELETE /api/admin/llm-config/:id — Remove a global config. */
  deleteGlobalLlmConfig: {
    audience: 'admin',
    method: 'delete',
    path: LLM_CONFIG_DETAIL_PATH,
    id: 'deleteGlobalLlmConfig',
    params: { id: z.string() },
    output: DeleteLlmConfigResponseSchema,
  },

  // ============================================================================
  // TTS config (global) — mirrors LLM config CRUD
  // ============================================================================

  listGlobalTtsConfigs: {
    audience: 'admin',
    method: 'get',
    path: '/tts-config',
    id: 'listGlobalTtsConfigs',
    output: ListTtsConfigsResponseSchema,
    meta: { safeRead: true },
  },

  getGlobalTtsConfig: {
    audience: 'admin',
    method: 'get',
    path: TTS_CONFIG_DETAIL_PATH,
    id: 'getGlobalTtsConfig',
    params: { id: z.string() },
    output: GetTtsConfigResponseSchema,
    meta: { safeRead: true },
  },

  createGlobalTtsConfig: {
    audience: 'admin',
    method: 'post',
    path: '/tts-config',
    id: 'createGlobalTtsConfig',
    input: TtsConfigCreateSchema,
    output: CreateTtsConfigResponseSchema,
  },

  updateGlobalTtsConfig: {
    audience: 'admin',
    method: 'put',
    path: TTS_CONFIG_DETAIL_PATH,
    id: 'updateGlobalTtsConfig',
    params: { id: z.string() },
    input: TtsConfigUpdateSchema,
    output: UpdateTtsConfigResponseSchema,
    meta: { idempotent: true },
  },

  setGlobalTtsConfigDefault: {
    audience: 'admin',
    method: 'put',
    path: '/tts-config/:id/set-default',
    id: 'setGlobalTtsConfigDefault',
    params: { id: z.string() },
    output: SetDefaultTtsConfigResponseSchema,
    meta: { idempotent: true },
  },

  setGlobalTtsConfigFreeDefault: {
    audience: 'admin',
    method: 'put',
    path: '/tts-config/:id/set-free-default',
    id: 'setGlobalTtsConfigFreeDefault',
    params: { id: z.string() },
    output: SetDefaultTtsConfigResponseSchema,
    meta: { idempotent: true },
  },

  deleteGlobalTtsConfig: {
    audience: 'admin',
    method: 'delete',
    path: TTS_CONFIG_DETAIL_PATH,
    id: 'deleteGlobalTtsConfig',
    params: { id: z.string() },
    output: DeleteTtsConfigResponseSchema,
  },

  // ============================================================================
  // Admin singletons (AdminSettings + observability)
  // ============================================================================

  /**
   * GET /api/admin/settings — Read the singleton admin-settings row (owner).
   * Owner-guarded at the prefix (requireUserAuth + requireOwnerAuth), which
   * rejects service-only callers before the handler's isAuthorizedForRead
   * check can run. Service callers (no Discord actor) read the same singleton
   * via the internal alias `getAdminSettingsInternal` (GET
   * /api/internal/admin-settings), which shares this handler but mounts under
   * the service-auth prefix.
   */
  getAdminSettings: {
    audience: 'admin',
    method: 'get',
    path: '/settings',
    id: 'getAdminSettings',
    output: AdminSettingsSchema,
    meta: { safeRead: true },
  },

  /** PATCH /api/admin/settings/config-defaults — Flat-body cascade update. */
  updateAdminSettings: {
    audience: 'admin',
    method: 'patch',
    path: '/settings/config-defaults',
    id: 'updateAdminSettings',
    // Flat body matches every other cascade tier's PATCH: a partial
    // ConfigOverrides shape (e.g., { maxMessages: 30 }), NOT the full
    // AdminSettings row. The handler's merge step writes only the
    // configDefaults JSONB column; the other AdminSettings fields are
    // ignored if present.
    input: ConfigOverridesSchema.partial(),
    output: AdminSettingsSchema,
  },

  /** GET /api/admin/settings/system — Read the system-settings bag + concurrency token. */
  getSystemSettings: {
    audience: 'admin',
    method: 'get',
    path: '/settings/system',
    id: 'getSystemSettings',
    output: GetSystemSettingsResponseSchema,
    meta: { safeRead: true },
  },

  /** PATCH /api/admin/settings/system — Validated partial write (registry-driven). */
  updateSystemSettings: {
    audience: 'admin',
    method: 'patch',
    path: '/settings/system',
    id: 'updateSystemSettings',
    // Envelope body (NOT flat like the cascade PATCH): the write carries the
    // optimistic-concurrency token alongside the patch, and the handler's
    // validation is registry-driven (catalog checks, coherence, floor rules).
    input: UpdateSystemSettingsRequestSchema,
    output: UpdateSystemSettingsResponseSchema,
  },

  /** DELETE /api/admin/settings/config-defaults — Clear all cascade defaults. */
  clearAdminSettings: {
    audience: 'admin',
    method: 'delete',
    path: '/settings/config-defaults',
    id: 'clearAdminSettings',
    // Inline minimal-envelope response; too trivial to warrant a named
    // schema export. Matches the cleanup-route inline-schema pattern above.
    output: z.object({ success: z.literal(true) }),
  },

  /**
   * GET /api/admin/usage — Aggregate usage statistics for the bot owner's
   * dashboard. Accepts ?timeframe= (e.g., 7d, 30d, 24h).
   */
  getAdminUsageStats: {
    audience: 'admin',
    method: 'get',
    path: '/usage',
    id: 'getAdminUsageStats',
    query: { timeframe: z.string().optional() },
    output: AdminUsageStatsSchema,
    meta: { safeRead: true },
  },
} as const satisfies Record<string, RouteDef>;
