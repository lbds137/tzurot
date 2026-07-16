/**
 * User-audience configuration routes.
 *
 * Covers per-user settings that aren't tied to a specific resource:
 * timezone, LLM/TTS config CRUD, per-personality override pinning,
 * STT default provider, model override.
 *
 * All routes here require provisioning — they operate on the caller's
 * own row, so the gateway must resolve the Discord ID to an internal
 * UUID at the middleware layer.
 */

import { z } from 'zod';
import { MODEL_SLOTS } from '@tzurot/common-types/constants/ai';
import { GATEWAY_TIMEOUTS } from '@tzurot/common-types/constants/discord';
import {
  CreateLlmConfigResponseSchema,
  DeleteLlmConfigResponseSchema,
  GetLlmConfigResponseSchema,
  ListLlmConfigsResponseSchema,
  LlmConfigCreateSchema,
  LlmConfigUpdateSchema,
  ResolveLlmConfigInputSchema,
  ResolveLlmConfigResponseSchema,
  UpdateLlmConfigResponseSchema,
} from '@tzurot/common-types/schemas/api/llm-config';
import {
  ClearDefaultConfigResponseSchema,
  DeleteModelOverrideResponseSchema,
  ListModelOverridesResponseSchema,
  SetDefaultConfigResponseSchema,
  SetDefaultConfigSchema,
  SetModelOverrideResponseSchema,
  SetModelOverrideSchema,
} from '@tzurot/common-types/schemas/api/model-override';
import {
  ClearSttDefaultProviderResponseSchema,
  SetSttDefaultProviderResponseSchema,
  SetSttDefaultProviderSchema,
} from '@tzurot/common-types/schemas/api/stt-override';
import {
  GetNotificationPrefsResponseSchema,
  UpdateNotificationPrefsInputSchema,
  UpdateNotificationPrefsResponseSchema,
  ListReleaseDmsResponseSchema,
  MarkReleaseDmsDeletedInputSchema,
  MarkReleaseDmsDeletedResponseSchema,
} from '@tzurot/common-types/schemas/api/notifications';
import {
  GetTimezoneResponseSchema,
  SetTimezoneInputSchema,
  SetTimezoneResponseSchema,
} from '@tzurot/common-types/schemas/api/timezone';
import {
  CreateTtsConfigResponseSchema,
  DeleteTtsConfigResponseSchema,
  GetTtsConfigResponseSchema,
  ListTtsConfigsResponseSchema,
  TtsConfigCreateSchema,
  TtsConfigUpdateSchema,
  UpdateTtsConfigResponseSchema,
} from '@tzurot/common-types/schemas/api/tts-config';
import {
  ClearTtsDefaultConfigResponseSchema,
  DeleteTtsOverrideResponseSchema,
  GetTtsDefaultConfigResponseSchema,
  ListTtsOverridesResponseSchema,
  SetTtsDefaultConfigResponseSchema,
  SetTtsDefaultConfigSchema,
  SetTtsOverrideResponseSchema,
  SetTtsOverrideSchema,
} from '@tzurot/common-types/schemas/api/tts-override';
import type { RouteDef } from '../types.js';

// Shared CRUD-detail path constants — GET/PUT/DELETE on the same :id share
// the literal three ways per resource.
const LLM_CONFIG_DETAIL_PATH = '/llm-config/:id';
const TTS_CONFIG_DETAIL_PATH = '/tts-config/:id';
const MODEL_OVERRIDE_DEFAULT_PATH = '/model-override/default';
const TTS_OVERRIDE_DEFAULT_PATH = '/tts-override/default';
const STT_OVERRIDE_PATH = '/stt-override';

export const userConfigRoutes = {
  // ============================================================================
  // Timezone (self-only)
  // ============================================================================

  getTimezone: {
    audience: 'user',
    method: 'get',
    path: '/timezone',
    id: 'getTimezone',
    output: GetTimezoneResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // Read post-defer in the settings dashboard; the autocomplete budget
    // is too tight for the slowest paths.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  setTimezone: {
    audience: 'user',
    method: 'put',
    path: '/timezone',
    id: 'setTimezone',
    input: SetTimezoneInputSchema,
    output: SetTimezoneResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  // ============================================================================
  // Release-notes notification preferences (self-only)
  // ============================================================================

  getNotificationPrefs: {
    audience: 'user',
    method: 'get',
    path: '/notifications',
    id: 'getNotificationPrefs',
    output: GetNotificationPrefsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  updateNotificationPrefs: {
    audience: 'user',
    method: 'patch',
    path: '/notifications',
    id: 'updateNotificationPrefs',
    input: UpdateNotificationPrefsInputSchema,
    output: UpdateNotificationPrefsResponseSchema,
    requiresProvisionedUser: true,
    // PATCH-merge of the same body lands the same state.
    meta: { idempotent: true },
  },

  listReleaseDms: {
    audience: 'user',
    method: 'get',
    path: '/notifications/release-dms',
    id: 'listReleaseDms',
    output: ListReleaseDmsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  markReleaseDmsDeleted: {
    audience: 'user',
    method: 'post',
    path: '/notifications/release-dms/deleted',
    id: 'markReleaseDmsDeleted',
    input: MarkReleaseDmsDeletedInputSchema,
    output: MarkReleaseDmsDeletedResponseSchema,
    requiresProvisionedUser: true,
    // Stamping the same rows twice lands the same state.
    meta: { idempotent: true },
  },

  // ============================================================================
  // LLM config (user-owned)
  // ============================================================================

  listUserLlmConfigs: {
    audience: 'user',
    method: 'get',
    path: '/llm-config',
    id: 'listUserLlmConfigs',
    output: ListLlmConfigsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // Dual-context route: autocomplete callers bounded by Discord's 3s
    // deadline; deferred-context callers (guestModeValidation) need the
    // longer budget.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  getUserLlmConfig: {
    audience: 'user',
    method: 'get',
    path: LLM_CONFIG_DETAIL_PATH,
    id: 'getUserLlmConfig',
    params: { id: z.string() },
    output: GetLlmConfigResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  createUserLlmConfig: {
    audience: 'user',
    method: 'post',
    path: '/llm-config',
    id: 'createUserLlmConfig',
    input: LlmConfigCreateSchema,
    output: CreateLlmConfigResponseSchema,
    requiresProvisionedUser: true,
    timeoutMs: GATEWAY_TIMEOUTS.WRITE,
  },

  updateUserLlmConfig: {
    audience: 'user',
    method: 'put',
    path: LLM_CONFIG_DETAIL_PATH,
    id: 'updateUserLlmConfig',
    params: { id: z.string() },
    input: LlmConfigUpdateSchema,
    output: UpdateLlmConfigResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
    timeoutMs: GATEWAY_TIMEOUTS.WRITE,
  },

  deleteUserLlmConfig: {
    audience: 'user',
    method: 'delete',
    path: LLM_CONFIG_DETAIL_PATH,
    id: 'deleteUserLlmConfig',
    params: { id: z.string() },
    output: DeleteLlmConfigResponseSchema,
    requiresProvisionedUser: true,
    timeoutMs: GATEWAY_TIMEOUTS.WRITE,
  },

  resolveUserLlmConfig: {
    audience: 'user',
    method: 'post',
    path: '/llm-config/resolve',
    id: 'resolveUserLlmConfig',
    input: ResolveLlmConfigInputSchema,
    output: ResolveLlmConfigResponseSchema,
    requiresProvisionedUser: true,
    // Called in the message-handling hot path (before any deferReply), so the
    // budget is the tight 2500ms AUTOCOMPLETE cap rather than DEFERRED — a slow
    // gateway must degrade to personality defaults fast, not stall the pipeline.
    // (This was the transport default already; declaring it pins the intent.)
    timeoutMs: GATEWAY_TIMEOUTS.AUTOCOMPLETE,
  },

  // ============================================================================
  // TTS config (user-owned) — mirrors LLM config CRUD shape
  // ============================================================================

  listUserTtsConfigs: {
    audience: 'user',
    method: 'get',
    path: '/tts-config',
    id: 'listUserTtsConfigs',
    output: ListTtsConfigsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // Dual-context route: autocomplete clients are bounded by Discord's
    // own 3s deadline, so the longer budget exists for the BYOK-probe
    // path where a list fetch precedes downstream gating logic.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  getUserTtsConfig: {
    audience: 'user',
    method: 'get',
    path: TTS_CONFIG_DETAIL_PATH,
    id: 'getUserTtsConfig',
    params: { id: z.string() },
    output: GetTtsConfigResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  createUserTtsConfig: {
    audience: 'user',
    method: 'post',
    path: '/tts-config',
    id: 'createUserTtsConfig',
    input: TtsConfigCreateSchema,
    output: CreateTtsConfigResponseSchema,
    requiresProvisionedUser: true,
  },

  updateUserTtsConfig: {
    audience: 'user',
    method: 'put',
    path: TTS_CONFIG_DETAIL_PATH,
    id: 'updateUserTtsConfig',
    params: { id: z.string() },
    input: TtsConfigUpdateSchema,
    output: UpdateTtsConfigResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  deleteUserTtsConfig: {
    audience: 'user',
    method: 'delete',
    path: TTS_CONFIG_DETAIL_PATH,
    id: 'deleteUserTtsConfig',
    params: { id: z.string() },
    output: DeleteTtsConfigResponseSchema,
    requiresProvisionedUser: true,
  },

  // ============================================================================
  // TTS override (per-personality TTS pinning + user default)
  // ============================================================================

  listTtsOverrides: {
    audience: 'user',
    method: 'get',
    path: '/tts-override',
    id: 'listTtsOverrides',
    output: ListTtsOverridesResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  setTtsOverride: {
    audience: 'user',
    method: 'put',
    path: '/tts-override',
    id: 'setTtsOverride',
    input: SetTtsOverrideSchema,
    output: SetTtsOverrideResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  deleteTtsOverride: {
    audience: 'user',
    method: 'delete',
    path: '/tts-override/:personalityId',
    id: 'deleteTtsOverride',
    params: { personalityId: z.string() },
    output: DeleteTtsOverrideResponseSchema,
    requiresProvisionedUser: true,
  },

  getTtsDefaultConfig: {
    audience: 'user',
    method: 'get',
    path: TTS_OVERRIDE_DEFAULT_PATH,
    id: 'getTtsDefaultConfig',
    output: GetTtsDefaultConfigResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  setTtsDefaultConfig: {
    audience: 'user',
    method: 'put',
    path: TTS_OVERRIDE_DEFAULT_PATH,
    id: 'setTtsDefaultConfig',
    input: SetTtsDefaultConfigSchema,
    output: SetTtsDefaultConfigResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  clearTtsDefaultConfig: {
    audience: 'user',
    method: 'delete',
    path: TTS_OVERRIDE_DEFAULT_PATH,
    id: 'clearTtsDefaultConfig',
    output: ClearTtsDefaultConfigResponseSchema,
    requiresProvisionedUser: true,
  },

  // ============================================================================
  // STT override (user default STT provider)
  // ============================================================================

  getSttDefaultProvider: {
    audience: 'user',
    method: 'get',
    path: STT_OVERRIDE_PATH,
    id: 'getSttDefaultProvider',
    // GET and PUT share the { default: { providerId } } envelope — the
    // handler wraps both. (The bare UserDefaultSttProviderSchema this entry
    // used to declare was never what the handler emitted.)
    output: SetSttDefaultProviderResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  setSttDefaultProvider: {
    audience: 'user',
    method: 'put',
    path: STT_OVERRIDE_PATH,
    id: 'setSttDefaultProvider',
    input: SetSttDefaultProviderSchema,
    output: SetSttDefaultProviderResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  clearSttDefaultProvider: {
    audience: 'user',
    method: 'delete',
    path: STT_OVERRIDE_PATH,
    id: 'clearSttDefaultProvider',
    output: ClearSttDefaultProviderResponseSchema,
    requiresProvisionedUser: true,
  },

  // ============================================================================
  // Model override (per-personality model pin + user default)
  // ============================================================================

  listModelOverrides: {
    audience: 'user',
    method: 'get',
    path: '/model-override',
    id: 'listModelOverrides',
    // Scope the listing to a slot (text|vision), or `all` to return both
    // (browse fetches both in one call — one row per occupied slot); defaults
    // text. The gateway parses this with parseModelSlotQueryAllowAll, so `all`
    // is a valid inbound value the manifest must permit.
    query: { slot: z.enum([...MODEL_SLOTS, 'all']).optional() },
    output: ListModelOverridesResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  setModelOverride: {
    audience: 'user',
    method: 'put',
    path: '/model-override',
    id: 'setModelOverride',
    input: SetModelOverrideSchema,
    // The slot the override occupies (text|vision); defaults text. The gateway
    // capability-gates the vision slot (its model must support image input).
    query: { slot: z.enum(MODEL_SLOTS).optional() },
    output: SetModelOverrideResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  deleteModelOverride: {
    audience: 'user',
    method: 'delete',
    path: '/model-override/:personalityId',
    id: 'deleteModelOverride',
    params: { personalityId: z.string() },
    // Scope the clear to a slot: `all` (the no-slot default) clears BOTH slots,
    // an explicit text|vision clears just that one.
    query: { slot: z.enum([...MODEL_SLOTS, 'all']).optional() },
    output: DeleteModelOverrideResponseSchema,
    requiresProvisionedUser: true,
  },

  getDefaultModelConfig: {
    audience: 'user',
    method: 'get',
    path: MODEL_OVERRIDE_DEFAULT_PATH,
    id: 'getDefaultModelConfig',
    output: SetDefaultConfigResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // DEFERRED budget: read post-defer in the model-settings
    // dashboard; matches the set/clear siblings on the same default path so
    // the read leg doesn't time out where the writes don't.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  setDefaultModelConfig: {
    audience: 'user',
    method: 'put',
    path: MODEL_OVERRIDE_DEFAULT_PATH,
    id: 'setDefaultModelConfig',
    input: SetDefaultConfigSchema,
    // The slot the default occupies (text|vision); defaults text. The gateway
    // capability-gates the vision slot (its model must support image input).
    query: { slot: z.enum(MODEL_SLOTS).optional() },
    output: SetDefaultConfigResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  clearDefaultModelConfig: {
    audience: 'user',
    method: 'delete',
    path: MODEL_OVERRIDE_DEFAULT_PATH,
    id: 'clearDefaultModelConfig',
    // Scope the clear to a slot: `all` (the no-slot default) clears BOTH slots,
    // an explicit text|vision clears just that one.
    query: { slot: z.enum([...MODEL_SLOTS, 'all']).optional() },
    output: ClearDefaultConfigResponseSchema,
    requiresProvisionedUser: true,
  },
} as const satisfies Record<string, RouteDef>;
