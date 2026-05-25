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
import { GATEWAY_TIMEOUTS } from '../constants/discord.js';
import {
  DbSyncSchema,
  DbSyncResponseSchema,
  AdminCleanupResponseSchema,
  InvalidateCacheSchema,
  InvalidateCacheResponseSchema,
  PersonalityCreateSchema,
  PersonalityUpdateSchema,
  CreatePersonalityResponseSchema,
  AdminPersonalityResponseSchema,
  DenylistAddSchema,
  AddDenylistResponseSchema,
  ListDenylistResponseSchema,
  RemoveDenylistResponseSchema,
  denylistEntityTypeSchema,
  denylistScopeSchema,
  LlmConfigCreateSchema,
  LlmConfigUpdateSchema,
  ListLlmConfigsResponseSchema,
  GetLlmConfigResponseSchema,
  CreateLlmConfigResponseSchema,
  UpdateLlmConfigResponseSchema,
  DeleteLlmConfigResponseSchema,
  SetDefaultLlmConfigResponseSchema,
  TtsConfigCreateSchema,
  TtsConfigUpdateSchema,
  ListTtsConfigsResponseSchema,
  GetTtsConfigResponseSchema,
  CreateTtsConfigResponseSchema,
  UpdateTtsConfigResponseSchema,
  DeleteTtsConfigResponseSchema,
  SetDefaultTtsConfigResponseSchema,
  AdminSettingsSchema,
  StopSequencesResponseSchema,
  UsageStatsSchema,
} from '../schemas/api/index.js';
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
   * POST /api/admin/db-sync — Apply pending Prisma migrations.
   *
   * Slow route (multi-second under load) — uses DEFERRED (10s) instead
   * of the AUTOCOMPLETE default (2500ms). Matches the legacy
   * `adminFetch('admin/db-sync')` budget so the typed-client cutover
   * preserves the existing timeout headroom.
   */
  dbSync: {
    audience: 'admin',
    method: 'post',
    path: '/db-sync',
    id: 'dbSync',
    input: DbSyncSchema,
    output: DbSyncResponseSchema,
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  /**
   * POST /api/admin/cleanup — Purge orphan history rows + tombstones.
   *
   * Slow route — duration is data-dependent (could span tens of seconds
   * for large purges). Uses BULK_OPERATION (30s) so the typed-client
   * cutover doesn't silently truncate the orphan-sweep work.
   */
  cleanup: {
    audience: 'admin',
    method: 'post',
    path: '/cleanup',
    id: 'cleanup',
    timeoutMs: GATEWAY_TIMEOUTS.BULK_OPERATION,
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
    output: CreatePersonalityResponseSchema,
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
  },

  /** GET /api/admin/llm-config/:id — Fetch one global config. */
  getGlobalLlmConfig: {
    audience: 'admin',
    method: 'get',
    path: LLM_CONFIG_DETAIL_PATH,
    id: 'getGlobalLlmConfig',
    params: { id: z.string() },
    output: GetLlmConfigResponseSchema,
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
  },

  /** PUT /api/admin/llm-config/:id/set-default — Promote to paid default. */
  setGlobalLlmConfigDefault: {
    audience: 'admin',
    method: 'put',
    path: '/llm-config/:id/set-default',
    id: 'setGlobalLlmConfigDefault',
    params: { id: z.string() },
    output: SetDefaultLlmConfigResponseSchema,
  },

  /** PUT /api/admin/llm-config/:id/set-free-default — Promote to free-tier default. */
  setGlobalLlmConfigFreeDefault: {
    audience: 'admin',
    method: 'put',
    path: '/llm-config/:id/set-free-default',
    id: 'setGlobalLlmConfigFreeDefault',
    params: { id: z.string() },
    output: SetDefaultLlmConfigResponseSchema,
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
  },

  getGlobalTtsConfig: {
    audience: 'admin',
    method: 'get',
    path: TTS_CONFIG_DETAIL_PATH,
    id: 'getGlobalTtsConfig',
    params: { id: z.string() },
    output: GetTtsConfigResponseSchema,
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
  },

  setGlobalTtsConfigDefault: {
    audience: 'admin',
    method: 'put',
    path: '/tts-config/:id/set-default',
    id: 'setGlobalTtsConfigDefault',
    params: { id: z.string() },
    output: SetDefaultTtsConfigResponseSchema,
  },

  setGlobalTtsConfigFreeDefault: {
    audience: 'admin',
    method: 'put',
    path: '/tts-config/:id/set-free-default',
    id: 'setGlobalTtsConfigFreeDefault',
    params: { id: z.string() },
    output: SetDefaultTtsConfigResponseSchema,
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
   * GET /api/admin/settings — Read the singleton admin-settings row.
   * Uses isAuthorizedForRead in the handler — allows service-only callers too
   * (audience is admin so requireOwnerAuth at prefix, but the singleton-read
   * is also reachable by services that need the same defaults). The manifest
   * keeps it admin-audience; service callers route through the legacy URL
   * until the architectural refactor finishes the unification.
   */
  getAdminSettings: {
    audience: 'admin',
    method: 'get',
    path: '/settings',
    id: 'getAdminSettings',
    output: AdminSettingsSchema,
  },

  /** PATCH /api/admin/settings/config-defaults — Flat-body cascade update. */
  updateAdminSettings: {
    audience: 'admin',
    method: 'patch',
    path: '/settings/config-defaults',
    id: 'updateAdminSettings',
    // Input mirrors the AdminSettings schema directly — handler validates with
    // safeParse via the same schema (matches the cascade tier shape).
    input: AdminSettingsSchema.partial(),
    output: AdminSettingsSchema,
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

  /** GET /api/admin/stop-sequences — Observability for ai-worker truncation stats. */
  getStopSequencesStats: {
    audience: 'admin',
    method: 'get',
    path: '/stop-sequences',
    id: 'getStopSequencesStats',
    output: StopSequencesResponseSchema,
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
    output: UsageStatsSchema,
  },
} as const satisfies Record<string, RouteDef>;

/** Admin-route ID union — used as a manifest key by generated clients. */
export type AdminRouteId = keyof typeof adminRoutes;
