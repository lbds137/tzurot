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
import {
  // Timezone
  GetTimezoneResponseSchema,
  SetTimezoneResponseSchema,
  SetTimezoneInputSchema,
  // LLM config
  LlmConfigCreateSchema,
  LlmConfigUpdateSchema,
  ListLlmConfigsResponseSchema,
  GetLlmConfigResponseSchema,
  CreateLlmConfigResponseSchema,
  UpdateLlmConfigResponseSchema,
  DeleteLlmConfigResponseSchema,
  ResolveLlmConfigInputSchema,
  ResolveLlmConfigResponseSchema,
  // TTS config
  TtsConfigCreateSchema,
  TtsConfigUpdateSchema,
  ListTtsConfigsResponseSchema,
  GetTtsConfigResponseSchema,
  CreateTtsConfigResponseSchema,
  UpdateTtsConfigResponseSchema,
  DeleteTtsConfigResponseSchema,
  // TTS override
  SetTtsOverrideSchema,
  SetTtsDefaultConfigSchema,
  ListTtsOverridesResponseSchema,
  SetTtsOverrideResponseSchema,
  GetTtsDefaultConfigResponseSchema,
  SetTtsDefaultConfigResponseSchema,
  ClearTtsDefaultConfigResponseSchema,
  DeleteTtsOverrideResponseSchema,
  // STT override
  SetSttDefaultProviderSchema,
  UserDefaultSttProviderSchema,
  SetSttDefaultProviderResponseSchema,
  ClearSttDefaultProviderResponseSchema,
  // Model override
  SetModelOverrideSchema,
  SetDefaultConfigSchema,
  ListModelOverridesResponseSchema,
  SetModelOverrideResponseSchema,
  SetDefaultConfigResponseSchema,
  ClearDefaultConfigResponseSchema,
  DeleteModelOverrideResponseSchema,
} from '../../schemas/api/index.js';
import { GATEWAY_TIMEOUTS } from '../../constants/discord.js';
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
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
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
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
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
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  deleteUserLlmConfig: {
    audience: 'user',
    method: 'delete',
    path: LLM_CONFIG_DETAIL_PATH,
    id: 'deleteUserLlmConfig',
    params: { id: z.string() },
    output: DeleteLlmConfigResponseSchema,
    requiresProvisionedUser: true,
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
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
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  deleteTtsOverride: {
    audience: 'user',
    method: 'delete',
    path: '/tts-override/:personalityId',
    id: 'deleteTtsOverride',
    params: { personalityId: z.string() },
    output: DeleteTtsOverrideResponseSchema,
    requiresProvisionedUser: true,
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
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
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  clearTtsDefaultConfig: {
    audience: 'user',
    method: 'delete',
    path: TTS_OVERRIDE_DEFAULT_PATH,
    id: 'clearTtsDefaultConfig',
    output: ClearTtsDefaultConfigResponseSchema,
    requiresProvisionedUser: true,
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  // ============================================================================
  // STT override (user default STT provider)
  // ============================================================================

  getSttDefaultProvider: {
    audience: 'user',
    method: 'get',
    path: STT_OVERRIDE_PATH,
    id: 'getSttDefaultProvider',
    output: UserDefaultSttProviderSchema,
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
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  clearSttDefaultProvider: {
    audience: 'user',
    method: 'delete',
    path: STT_OVERRIDE_PATH,
    id: 'clearSttDefaultProvider',
    output: ClearSttDefaultProviderResponseSchema,
    requiresProvisionedUser: true,
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  // ============================================================================
  // Model override (per-personality model pin + user default)
  // ============================================================================

  listModelOverrides: {
    audience: 'user',
    method: 'get',
    path: '/model-override',
    id: 'listModelOverrides',
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
    output: SetModelOverrideResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  deleteModelOverride: {
    audience: 'user',
    method: 'delete',
    path: '/model-override/:personalityId',
    id: 'deleteModelOverride',
    params: { personalityId: z.string() },
    output: DeleteModelOverrideResponseSchema,
    requiresProvisionedUser: true,
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  getDefaultModelConfig: {
    audience: 'user',
    method: 'get',
    path: MODEL_OVERRIDE_DEFAULT_PATH,
    id: 'getDefaultModelConfig',
    output: SetDefaultConfigResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  setDefaultModelConfig: {
    audience: 'user',
    method: 'put',
    path: MODEL_OVERRIDE_DEFAULT_PATH,
    id: 'setDefaultModelConfig',
    input: SetDefaultConfigSchema,
    output: SetDefaultConfigResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  clearDefaultModelConfig: {
    audience: 'user',
    method: 'delete',
    path: MODEL_OVERRIDE_DEFAULT_PATH,
    id: 'clearDefaultModelConfig',
    output: ClearDefaultConfigResponseSchema,
    requiresProvisionedUser: true,
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },
} as const satisfies Record<string, RouteDef>;
