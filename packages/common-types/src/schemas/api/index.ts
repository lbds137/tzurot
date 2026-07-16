/**
 * API Response Schemas
 *
 * Centralized Zod schemas for all API endpoint responses.
 * These define the contract between api-gateway and bot-client.
 */

// Shared schemas (permissions, etc.)
export { emptyToNull, EntityPermissionsSchema, nullableString, optionalString } from './shared.js';

// Persona endpoints
export {
  type ClearOverrideResponse,
  ClearOverrideResponseSchema,
  type CreateOverrideResponse,
  CreateOverrideResponseSchema,
  type CreatePersonaResponse,
  CreatePersonaResponseSchema,
  DeletePersonaResponseSchema,
  type GetPersonaResponse,
  GetPersonaResponseSchema,
  ListPersonaOverridesResponseSchema,
  type ListPersonasResponse,
  ListPersonasResponseSchema,
  type OverrideInfoResponse,
  OverrideInfoResponseSchema,
  PERSONA_SELECT,
  PersonaCreateSchema,
  type PersonaDetails,
  PersonaDetailsSchema,
  type PersonaSummary,
  PersonaSummarySchema,
  type PersonaUpdateInput,
  PersonaUpdateSchema,
  type SetDefaultPersonaResponse,
  SetDefaultPersonaResponseSchema,
  type SetOverrideResponse,
  SetOverrideResponseSchema,
  SetPersonaOverrideSchema,
  UpdatePersonaResponseSchema,
} from './persona.js';

// Personality endpoints
export {
  AdminPersonalityResponseSchema,
  type CreatePersonalityResponse,
  CreatePersonalityResponseSchema,
  DeletePersonalityResponseSchema,
  type GetPersonalityResponse,
  GetPersonalityResponseSchema,
  type ListPersonalitiesResponse,
  ListPersonalitiesResponseSchema,
  PERSONALITY_DETAIL_SELECT,
  PERSONALITY_LIST_SELECT,
  type PersonalityCharacterFields,
  PersonalityCharacterFieldsSchema,
  type PersonalityCreateInput,
  PersonalityCreateSchema,
  type PersonalityFull,
  PersonalityFullSchema,
  type PersonalitySummary,
  PersonalitySummarySchema,
  type PersonalityUpdateInput,
  PersonalityUpdateSchema,
  SetVisibilitySchema,
} from './personality.js';

// Model Override endpoints
export {
  type ClearDefaultConfigResponse,
  ClearDefaultConfigResponseSchema,
  type DeleteModelOverrideResponse,
  DeleteModelOverrideResponseSchema,
  type ListModelOverridesResponse,
  ListModelOverridesResponseSchema,
  type ModelOverrideSummary,
  ModelOverrideSummarySchema,
  type SetDefaultConfigResponse,
  SetDefaultConfigResponseSchema,
  SetDefaultConfigSchema,
  type SetModelOverrideResponse,
  SetModelOverrideResponseSchema,
  SetModelOverrideSchema,
  type UserDefaultConfig,
  UserDefaultConfigSchema,
} from './model-override.js';

// Model catalog (/api/internal/models)
export { ModelAutocompleteOptionSchema, ModelsListResponseSchema } from './models.js';

// Wallet endpoints
export {
  type ListWalletKeysResponse,
  ListWalletKeysResponseSchema,
  type RemoveWalletKeyResponse,
  RemoveWalletKeyResponseSchema,
  SetWalletKeyResponseSchema,
  SetWalletKeySchema,
  type TestWalletKeyResponse,
  TestWalletKeyResponseSchema,
  TestWalletKeySchema,
  type WalletKey,
  WalletKeySchema,
} from './wallet.js';

// Timezone endpoints
export {
  type GetTimezoneResponse,
  GetTimezoneResponseSchema,
  SetTimezoneInputSchema,
  type SetTimezoneResponse,
  SetTimezoneResponseSchema,
} from './timezone.js';

// Release-broadcast endpoints (admin blast + internal delivery ledger)
export {
  BROADCAST_MESSAGE_MAX_LENGTH,
  BroadcastInputSchema,
  BroadcastResponseSchema,
  type DeliveryOutcome,
  DeliveryOutcomeSchema,
  ReleaseBroadcastDeliveriesInputSchema,
  ReleaseBroadcastDeliveriesResponseSchema,
  ReleaseBroadcastPendingInputSchema,
  ReleaseBroadcastPendingResponseSchema,
  ReleaseReconcileInputSchema,
  ReleaseReconcileResponseSchema,
} from './broadcast.js';

// Notification-preference endpoints
export {
  type GetNotificationPrefsResponse,
  GetNotificationPrefsResponseSchema,
  NotifyLevelSchema,
  type NotifyLevelValue,
  UpdateNotificationPrefsInputSchema,
  type UpdateNotificationPrefsResponse,
  UpdateNotificationPrefsResponseSchema,
} from './notifications.js';

// LLM Config endpoints
export {
  type CreateLlmConfigResponse,
  CreateLlmConfigResponseSchema,
  type DeleteLlmConfigResponse,
  DeleteLlmConfigResponseSchema,
  GetLlmConfigResponseSchema,
  type ListLlmConfigsResponse,
  ListLlmConfigsResponseSchema,
  LLM_CONFIG_DEFAULTS,
  LLM_CONFIG_DETAIL_SELECT,
  LLM_CONFIG_LIST_SELECT,
  type LlmConfigCreateInput,
  LlmConfigCreateSchema,
  type LlmConfigDetail,
  LlmConfigDetailSchema,
  type LlmConfigSummary,
  LlmConfigSummarySchema,
  type LlmConfigUpdateInput,
  LlmConfigUpdateSchema,
  ResolveLlmConfigInputSchema,
  ResolveLlmConfigResponseSchema,
  type SetDefaultLlmConfigResponse,
  SetDefaultLlmConfigResponseSchema,
  UpdateLlmConfigResponseSchema,
} from './llm-config.js';

// TTS Config endpoints
export {
  CreateTtsConfigResponseSchema,
  DeleteTtsConfigResponseSchema,
  GetTtsConfigResponseSchema,
  ListTtsConfigsResponseSchema,
  SetDefaultTtsConfigResponseSchema,
  TTS_CONFIG_DEFAULTS,
  TTS_CONFIG_DETAIL_SELECT,
  TTS_CONFIG_LIST_SELECT,
  TtsAdvancedParamsSchema,
  type TtsConfigCreateInput,
  TtsConfigCreateSchema,
  type TtsConfigSummary,
  TtsConfigSummarySchema,
  type TtsConfigUpdateInput,
  TtsConfigUpdateSchema,
  TtsProviderIdSchema,
  UpdateTtsConfigResponseSchema,
} from './tts-config.js';

// TTS Override endpoints (per-personality + user default)
export {
  type ClearTtsDefaultConfigResponse,
  ClearTtsDefaultConfigResponseSchema,
  DeleteTtsOverrideResponseSchema,
  GetTtsDefaultConfigResponseSchema,
  ListTtsOverridesResponseSchema,
  SetTtsDefaultConfigResponseSchema,
  SetTtsDefaultConfigSchema,
  SetTtsOverrideResponseSchema,
  SetTtsOverrideSchema,
  type TtsOverrideSummary,
  TtsOverrideSummarySchema,
  type UserDefaultTtsConfig,
  UserDefaultTtsConfigSchema,
} from './tts-override.js';

// STT Override endpoints (per-personality + user default STT provider)
export {
  ClearSttDefaultProviderResponseSchema,
  SetSttDefaultProviderResponseSchema,
  SetSttDefaultProviderSchema,
  type UserDefaultSttProvider,
  UserDefaultSttProviderSchema,
} from './stt-override.js';

// Voice resolution aggregate read endpoint backing /voice view
export {
  type ClonedVoicesSummary,
  ClonedVoicesSummarySchema,
  GetVoiceResolutionQuerySchema,
  type GetVoiceResolutionResponse,
  GetVoiceResolutionResponseSchema,
  type ResolvedSttView,
  ResolvedSttViewSchema,
  type ResolvedTtsView,
  ResolvedTtsViewSchema,
  type SttResolutionSource,
  SttResolutionSourceSchema,
  type TtsResolutionSource,
  TtsResolutionSourceSchema,
} from './voice-resolution.js';

// Channel activation endpoints
export {
  ActivateChannelRequestSchema,
  ActivateChannelResponseSchema,
  type ChannelSettings,
  ChannelSettingsSchema,
  DeactivateChannelRequestSchema,
  DeactivateChannelResponseSchema,
  type GetChannelSettingsResponse,
  GetChannelSettingsResponseSchema,
  ListChannelSettingsResponseSchema,
  UpdateChannelGuildRequestSchema,
  UpdateChannelGuildResponseSchema,
} from './channel.js';

// Admin settings endpoints (singleton pattern)
export {
  ADMIN_SETTINGS_SINGLETON_ID,
  type AdminSettings,
  AdminSettingsSchema,
  type GetAdminSettingsResponse,
  type ResolvedExtendedContextSettings,
  ResolvedExtendedContextSettingsSchema,
  type SettingSource,
} from './adminSettings.js';

// Config cascade overrides (JSONB column schema)
export {
  ClearChannelConfigOverridesResponseSchema,
  ClearPersonalityConfigOverridesResponseSchema,
  ClearUserConfigDefaultsResponseSchema,
  CONFIG_OVERRIDES_KEYS,
  type ConfigOverrides,
  type ConfigOverrideSource,
  ConfigOverridesSchema,
  GetChannelConfigOverridesResponseSchema,
  GetUserConfigDefaultsResponseSchema,
  HARDCODED_CONFIG_DEFAULTS,
  type ResolvedConfigOverrides,
  ResolvedConfigOverridesSchema,
  ResolveUserConfigDefaultsResponseSchema,
  UpdateChannelConfigOverridesRequestSchema,
  UpdateChannelConfigOverridesResponseSchema,
  UpdateConfigDefaultsResponseSchema,
  UpdatePersonalityConfigOverridesResponseSchema,
} from './configOverrides.js';

// Usage endpoints
export {
  type AdminUsageStats,
  AdminUsageStatsSchema,
  TopUserUsageSchema,
  UsageBreakdownSchema,
  type UsagePeriod,
  UsagePeriodSchema,
  type UsageStats,
  UsageStatsSchema,
} from './usage.js';

// NSFW verification endpoints
export { GetNsfwStatusResponseSchema, VerifyNsfwResponseSchema } from './nsfw.js';

// Voice cloning management endpoints
export {
  ClearVoicesResponseSchema,
  DeleteVoiceResponseSchema,
  ListVoiceModelsResponseSchema,
  ListVoicesResponseSchema,
  ProviderWarningSchema,
  TaggedVoiceSchema,
  VoiceModelSchema,
} from './voices.js';

// Memory incognito mode endpoints
export {
  DisableIncognitoResponseSchema,
  EnableIncognitoResponseSchema,
  GetIncognitoStatusResponseSchema,
  IncognitoForgetResponseSchema,
  type IncognitoSessionWithRemaining,
  IncognitoSessionWithRemainingSchema,
} from './memoryIncognito.js';

// Account data-rights endpoints live in './account.js' — import via the
// subpath (schemas/api/account); not re-exported here (max-lines budget).

// Shapes.inc BYOK integration endpoints
export {
  DeleteShapesAuthResponseSchema,
  ListShapesExportJobsResponseSchema,
  ListShapesImportJobsResponseSchema,
  ListShapesResponseSchema,
  ShapesAuthStatusResponseSchema,
  ShapesExportJobSummarySchema,
  ShapesImportJobSummarySchema,
  ShapesListItemSchema,
  StartShapesExportInputSchema,
  StartShapesExportResponseSchema,
  StartShapesImportInputSchema,
  StartShapesImportResponseSchema,
  StoreShapesAuthInputSchema,
  StoreShapesAuthResponseSchema,
} from './shapes.js';

// Denylist schemas
export {
  AddDenylistResponseSchema,
  DenylistAddSchema,
  type DenylistCacheResponse,
  DenylistCacheResponseSchema,
  type DenylistEntityType,
  denylistEntityTypeSchema,
  type DenylistEntry,
  DenylistEntrySchema,
  type DenylistMode,
  denylistModeSchema,
  type DenylistScope,
  denylistScopeSchema,
  ListDenylistResponseSchema,
  RemoveDenylistResponseSchema,
} from './denylist.js';

// Admin input schemas
export { DbSyncSchema, DiagnosticUpdateSchema, InvalidateCacheSchema } from './admin.js';

// Memory input schemas
export {
  type BatchDeletePreviewInput,
  BatchDeletePreviewResponseSchema,
  BatchDeletePreviewSchema,
  BatchDeleteResponseSchema,
  BatchDeleteSchema,
  DeleteMemoryResponseSchema,
  FocusModeSchema,
  FocusModeStatusResponseSchema,
  IssuePurgeTokenResponseSchema,
  IssuePurgeTokenSchema,
  type MemoryItem,
  MemoryItemSchema,
  type MemoryListResponse,
  MemoryListResponseSchema,
  MemorySearchResponseSchema,
  MemorySearchResultSchema,
  MemorySearchSchema,
  MemoryStatsResponseSchema,
  MemoryUpdateSchema,
  PreviewTokenSchema,
  type PurgeMemoriesResponse,
  PurgeMemoriesResponseSchema,
  PurgeMemoriesSchema,
  PurgeTokenSchema,
  SetFocusResponseSchema,
  SetMemoryLockSchema,
  SingleMemoryResponseSchema,
} from './memory.js';

// Memory-fact schemas (memory Phase 2)
export {
  CorrectFactRequestSchema,
  CorrectFactResponseSchema,
  FACT_TIERS,
  FactItemSchema,
  FactListResponseSchema,
  FactTierSchema,
  ForgetFactResponseSchema,
  GetFactResponseSchema,
  SetFactLockRequestSchema,
  SetFactLockResponseSchema,
} from './fact.js';

// History input schemas
export {
  ClearHistoryResponseSchema,
  ClearHistorySchema,
  HardDeleteHistoryResponseSchema,
  HardDeleteHistorySchema,
  HistoryStatsQuerySchema,
  HistoryStatsResponseSchema,
  UndoHistoryResponseSchema,
  UndoHistorySchema,
} from './history.js';

// Transcribe input schemas
export { TranscribeRequestSchema } from './transcribe.js';

// Internal service-to-service endpoints
export {
  ConversationSyncRequestSchema,
  type ConversationSyncResponse,
  ConversationSyncResponseSchema,
  DiscordSnowflakeSchema,
  DmSessionSetRequestSchema,
  DmSessionSetResponseSchema,
  type LoadPersonalityInternalResponse,
  LoadPersonalityInternalResponseSchema,
  MessagePersonalityResponseSchema,
  PersistAssistantMessageRequestSchema,
  type PersistAssistantMessageResponse,
  PersistAssistantMessageResponseSchema,
  PersistUserMessageRequestSchema,
  type PersistUserMessageResponse,
  PersistUserMessageResponseSchema,
  RecentUsersResponseSchema,
  type RoutingContextRequest,
  RoutingContextRequestSchema,
  type RoutingContextResponse,
  RoutingContextResponseSchema,
} from './internal.js';

// Diagnostic endpoints (response schemas for /admin/diagnostic/*)
export {
  type DiagnosticLog,
  type DiagnosticLogResponse,
  DiagnosticLogResponseSchema,
  DiagnosticLogSchema,
  type DiagnosticLogsResponse,
  DiagnosticLogsResponseSchema,
  DiagnosticUpdateResponseSchema,
  RecentDiagnosticLogSchema,
  type RecentDiagnosticLogsResponse,
  RecentDiagnosticLogsResponseSchema,
} from './diagnostic.js';

// AI endpoints (response schemas for /ai/{generate,transcribe,job/:id/...})
export {
  AiConfirmDeliveryResponseSchema,
  AiGenerateResponseSchema,
  AiJobAckResponseSchema,
  AiJobStatusResponseSchema,
  AiTranscribeResponseSchema,
} from './ai.js';

// Admin operational routes (db-sync, cleanup, invalidate-cache responses)
export {
  AdminCleanupResponseSchema,
  DbSyncResponseSchema,
  InvalidateCacheResponseSchema,
} from './admin-operations.js';
