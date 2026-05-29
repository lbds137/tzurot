/**
 * User-audience config-overrides routes.
 *
 * Two distinct shapes mounted under /api/user/config-overrides/:
 *
 *  1. User cascade-tier endpoints (user-default + user-personality):
 *     - GET /resolve-defaults: hardcoded → admin → user-default cascade (flat shape)
 *     - GET /defaults: raw user-tier JSONB
 *     - PATCH /defaults: merge update user-tier
 *     - DELETE /defaults: clear user-tier
 *     - GET /resolve/:personalityId: full 5-tier cascade resolution
 *     - PATCH /:personalityId: merge update user-personality tier
 *     - DELETE /:personalityId: clear user-personality tier
 *
 *  2. Personality-tier endpoints (creator-only writes):
 *     - GET /resolve-personality/:personalityId: hardcoded → admin → personality cascade
 *     - PATCH /personality/:personalityId: update Personality.configDefaults
 *
 * Every entry requires provisioning. None uses acceptsSubject.
 */

import { z } from 'zod';
import {
  ConfigOverridesSchema,
  ResolvedConfigOverridesSchema,
  ResolveUserConfigDefaultsResponseSchema,
  GetUserConfigDefaultsResponseSchema,
  UpdateConfigDefaultsResponseSchema,
  ClearUserConfigDefaultsResponseSchema,
  UpdatePersonalityConfigOverridesResponseSchema,
  ClearPersonalityConfigOverridesResponseSchema,
} from '../../schemas/api/index.js';
import { GATEWAY_TIMEOUTS } from '../../constants/discord.js';
import type { RouteDef } from '../types.js';

const BASE = '/config-overrides';
const PERSONALITY_ID_PARAM_PATH = `${BASE}/:personalityId`;
const PERSONALITY_NESTED_PATH = `${BASE}/personality/:personalityId`;
// `RESOLVE_FULL_CASCADE_PATH` is the user-tier 5-tier resolution
// (hardcoded → admin → personality → channel → user-default → user-personality).
// `RESOLVE_PERSONALITY_TIER_PATH` is the personality-tier 3-tier resolution
// (hardcoded → admin → personality only — strips the user-specific tiers).
const RESOLVE_PERSONALITY_TIER_PATH = `${BASE}/resolve-personality/:personalityId`;
const RESOLVE_FULL_CASCADE_PATH = `${BASE}/resolve/:personalityId`;

export const userConfigOverrideRoutes = {
  // ============================================================================
  // User cascade-tier endpoints
  // ============================================================================

  resolveUserDefaults: {
    audience: 'user',
    method: 'get',
    path: `${BASE}/resolve-defaults`,
    id: 'resolveUserDefaults',
    output: ResolveUserConfigDefaultsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  getUserDefaults: {
    audience: 'user',
    method: 'get',
    path: `${BASE}/defaults`,
    id: 'getUserDefaults',
    output: GetUserConfigDefaultsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  updateUserDefaults: {
    audience: 'user',
    method: 'patch',
    path: `${BASE}/defaults`,
    id: 'updateUserDefaults',
    input: ConfigOverridesSchema,
    output: UpdateConfigDefaultsResponseSchema,
    requiresProvisionedUser: true,
  },

  clearUserDefaults: {
    audience: 'user',
    method: 'delete',
    path: `${BASE}/defaults`,
    id: 'clearUserDefaults',
    output: ClearUserConfigDefaultsResponseSchema,
    requiresProvisionedUser: true,
  },

  resolveCascade: {
    audience: 'user',
    method: 'get',
    path: RESOLVE_FULL_CASCADE_PATH,
    id: 'resolveCascade',
    params: { personalityId: z.string() },
    query: { channelId: z.string().optional() },
    output: ResolvedConfigOverridesSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // 5-tier cascade resolution can chain several Prisma reads on a slow
    // day; the autocomplete-budget transport default (2500ms) is too tight
    // for the slash-command callers (handleSettings / handleOverrides /
    // fetchAndConvertSettingsData) that drive dashboards post-defer.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  updatePersonalityOverrides: {
    audience: 'user',
    method: 'patch',
    path: PERSONALITY_ID_PARAM_PATH,
    id: 'updatePersonalityOverrides',
    params: { personalityId: z.string() },
    input: ConfigOverridesSchema,
    output: UpdatePersonalityConfigOverridesResponseSchema,
    requiresProvisionedUser: true,
    // PATCH + resolve form a paired handshake; consistent budget across
    // both prevents the resolve from timing out after a successful PATCH.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  clearPersonalityOverrides: {
    audience: 'user',
    method: 'delete',
    path: PERSONALITY_ID_PARAM_PATH,
    id: 'clearPersonalityOverrides',
    params: { personalityId: z.string() },
    output: ClearPersonalityConfigOverridesResponseSchema,
    requiresProvisionedUser: true,
  },

  // ============================================================================
  // Personality-tier endpoints (creator-only writes)
  //
  // No DELETE counterpart by design: PATCH `mergeConfigOverrides` treats
  // `null` field values as "clear this override" and removes them from the
  // stored JSONB; a body of `{ maxMessages: null, maxAge: null, ... }`
  // (or simply `{}` which produces no merged keys) clears the tier
  // entirely. User-tier exposes a separate DELETE for the same operation
  // because it's a more frequent caller-facing action; personality-tier
  // edits are creator-only and rarer, so the PATCH-with-null pattern is
  // the only documented clear path.
  // ============================================================================

  resolvePersonalityCascade: {
    audience: 'user',
    method: 'get',
    path: RESOLVE_PERSONALITY_TIER_PATH,
    id: 'resolvePersonalityCascade',
    params: { personalityId: z.string() },
    output: ResolvedConfigOverridesSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // See timeout note on `resolveCascade` above — same multi-tier resolve
    // cost applies to the 3-tier creator path.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  updatePersonalityConfigDefaults: {
    audience: 'user',
    method: 'patch',
    path: PERSONALITY_NESTED_PATH,
    id: 'updatePersonalityConfigDefaults',
    params: { personalityId: z.string() },
    input: ConfigOverridesSchema,
    output: UpdateConfigDefaultsResponseSchema,
    requiresProvisionedUser: true,
    // Same PATCH + resolve handshake invariant as updatePersonalityOverrides.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },
} as const satisfies Record<string, RouteDef>;
