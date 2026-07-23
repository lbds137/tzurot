/**
 * Manifest-id → handler-source-file map.
 *
 * Returns the import path (relative to `services/api-gateway/src/routes/_generated/`)
 * where the `handle{PascalCase(id)}` export for the given route id lives.
 *
 * The map is **explicit by design** rather than computed from a convention,
 * because the audience boundary at the manifest level (internal / admin /
 * user) is orthogonal to the file layout. Several routes cross the boundary
 * — e.g. `getChannelSettings` is an `internal` route but its handler lives
 * in `user/channel/get.ts`, sharing the implementation with the user-tier
 * `getUserChannel` route.
 *
 * When adding a new route to ROUTE_MANIFEST, also add its entry here. The
 * invariant tests in `packages/tooling/src/codegen/handler-paths.test.ts`
 * assert every manifest id has an entry; if it ever omits one the codegen
 * will throw a clear error rather than emit a broken import.
 */

import { capitalizeFirst } from './string-utils.js';

// Re-used import paths (most multi-endpoint files have multiple ids
// mapped at them). Extracted into constants so sonarjs's
// no-duplicate-string lint stops counting them.
const ADMIN_DENYLIST = '../admin/denylist.js';
const ADMIN_DIAGNOSTIC = '../admin/diagnostic.js';
const ADMIN_LLM_CONFIG = '../admin/llm-config.js';
const ADMIN_SETTINGS = '../admin/settings.js';
const SYSTEM_SETTINGS = '../admin/systemSettings.js';
const ADMIN_TTS_CONFIG = '../admin/tts-config.js';
const USER_CHANNEL_GET = '../user/channel/get.js';
const USER_CHANNEL_CONFIG_OVERRIDES = '../user/channel/configOverrides.js';
const USER_HISTORY = '../user/history.js';
const USER_LLM_CONFIG = '../user/llm-config.js';
const USER_MEMORY = '../user/memory.js';
const USER_MEMORY_BATCH = '../user/memoryBatch.js';
const USER_MEMORY_INCOGNITO = '../user/memoryIncognito.js';
const USER_MEMORY_FRESH = '../user/memoryFresh.js';
const USER_MEMORY_LIST = '../user/memoryList.js';
const USER_MEMORY_SEARCH = '../user/memorySearch.js';
const USER_MEMORY_SINGLE = '../user/memorySingle.js';
const USER_MEMORY_FACTS = '../user/memoryFacts.js';
const USER_CONFIG_OVERRIDES = '../user/config-overrides.js';
const USER_PERSONALITY_CONFIG_OVERRIDES = '../user/personality-config-overrides.js';
const USER_SHAPES_AUTH = '../user/shapes/auth.js';
const USER_SHAPES_LIST = '../user/shapes/list.js';
const USER_SHAPES_IMPORT = '../user/shapes/import.js';
const USER_SHAPES_EXPORT = '../user/shapes/export.js';
const USER_ACCOUNT_EXPORT = '../user/account/export.js';
const USER_ACCOUNT_DELETE = '../user/account/delete.js';
const USER_FEEDBACK = '../user/feedback.js';
const USER_MODEL_OVERRIDE = '../user/model-override.js';
const USER_PERSONA_CRUD = '../user/persona/crud.js';
const USER_PERSONA_OVERRIDE = '../user/persona/override.js';
const ADMIN_BROADCAST = '../admin/broadcast.js';
const INTERNAL_RELEASE_BROADCAST = '../internal/releaseBroadcast.js';
const USER_NOTIFICATIONS = '../user/notifications.js';
const USER_STT_OVERRIDE = '../user/stt-override.js';
const USER_TIMEZONE = '../user/timezone.js';
const USER_TTS_CONFIG = '../user/tts-config.js';
const USER_TTS_OVERRIDE = '../user/tts-override.js';
const USER_VOICES = '../user/voices.js';

const PERSONALITY_ALIASES_PATH = '../user/personality/aliases.js';

const PATH_MAP: Readonly<Record<string, string>> = {
  // Channel
  activateChannel: '../user/channel/activate.js',
  deactivateChannel: '../user/channel/deactivate.js',
  getChannelConfigOverrides: USER_CHANNEL_CONFIG_OVERRIDES,
  updateChannelConfigOverrides: USER_CHANNEL_CONFIG_OVERRIDES,
  clearChannelConfigOverrides: USER_CHANNEL_CONFIG_OVERRIDES,
  getChannelSettings: USER_CHANNEL_GET,
  getUserChannel: USER_CHANNEL_GET,
  listUserChannels: '../user/channel/list.js',
  updateChannelGuild: '../user/channel/updateGuild.js',

  // Denylist
  addDenylistEntry: ADMIN_DENYLIST,
  getDenylistCache: ADMIN_DENYLIST,
  listDenylistEntries: ADMIN_DENYLIST,
  removeDenylistEntry: ADMIN_DENYLIST,

  // AI
  aiConfirmDelivery: '../ai/confirmDelivery.js',
  aiGenerate: '../ai/generate.js',
  aiJobStatus: '../ai/jobStatus.js',
  aiTranscribe: '../ai/transcribe.js',

  // Admin
  cleanup: '../admin/cleanup.js',
  createGlobalPersonality: '../admin/createPersonality.js',
  updateGlobalPersonality: '../admin/updatePersonality.js',
  dbSync: '../admin/dbSync.js',
  invalidateCache: '../admin/invalidateCache.js',
  getAdminUsageStats: '../admin/usage.js',

  // Admin settings
  clearAdminSettings: ADMIN_SETTINGS,
  getAdminSettings: ADMIN_SETTINGS,
  updateAdminSettings: ADMIN_SETTINGS,
  // Internal service-read alias for AdminSettings — reuses the admin handler.
  getAdminSettingsInternal: ADMIN_SETTINGS,

  // Admin system settings (the non-cascading operational bag)
  getSystemSettings: SYSTEM_SETTINGS,
  updateSystemSettings: SYSTEM_SETTINGS,

  // Admin diagnostic
  getDiagnosticByMessage: ADMIN_DIAGNOSTIC,
  getDiagnosticByRequestId: ADMIN_DIAGNOSTIC,
  getDiagnosticByResponse: ADMIN_DIAGNOSTIC,
  getRecentDiagnostics: ADMIN_DIAGNOSTIC,
  updateDiagnosticResponseIds: ADMIN_DIAGNOSTIC,

  // Admin LLM config
  createGlobalLlmConfig: ADMIN_LLM_CONFIG,
  deleteGlobalLlmConfig: ADMIN_LLM_CONFIG,
  getGlobalLlmConfig: ADMIN_LLM_CONFIG,
  listGlobalLlmConfigs: ADMIN_LLM_CONFIG,
  setGlobalLlmConfigDefault: ADMIN_LLM_CONFIG,
  setGlobalLlmConfigFreeDefault: ADMIN_LLM_CONFIG,
  updateGlobalLlmConfig: ADMIN_LLM_CONFIG,

  // Admin TTS config
  createGlobalTtsConfig: ADMIN_TTS_CONFIG,
  deleteGlobalTtsConfig: ADMIN_TTS_CONFIG,
  getGlobalTtsConfig: ADMIN_TTS_CONFIG,
  listGlobalTtsConfigs: ADMIN_TTS_CONFIG,
  setGlobalTtsConfigDefault: ADMIN_TTS_CONFIG,
  setGlobalTtsConfigFreeDefault: ADMIN_TTS_CONFIG,
  updateGlobalTtsConfig: ADMIN_TTS_CONFIG,

  // Internal
  recentUsers: '../internal/usersRecent.js',
  stampUserActivity: '../internal/usersActivity.js',
  listPersonalityAliases: PERSONALITY_ALIASES_PATH,
  addPersonalityAlias: PERSONALITY_ALIASES_PATH,
  removePersonalityAlias: PERSONALITY_ALIASES_PATH,
  listMyAliases: PERSONALITY_ALIASES_PATH,
  secretRotationStatus: '../internal/secretRotationStatus.js',
  getModels: '../internal/models.js',
  setDmSession: '../internal/dmSessionSet.js',
  lookupPersonalityFromMessage: '../user/conversationLookup.js',
  persistAssistantMessage: '../internal/conversationAssistantMessage.js',
  persistUserMessage: '../internal/conversationUserMessage.js',
  syncConversation: '../internal/conversationSync.js',
  loadPersonalityInternal: '../internal/personalityLoad.js',
  routingContextCreate: '../internal/routingContextCreate.js',

  // User LLM config
  createUserLlmConfig: USER_LLM_CONFIG,
  deleteUserLlmConfig: USER_LLM_CONFIG,
  getUserLlmConfig: USER_LLM_CONFIG,
  listUserLlmConfigs: USER_LLM_CONFIG,
  resolveUserLlmConfig: USER_LLM_CONFIG,
  updateUserLlmConfig: USER_LLM_CONFIG,

  // User TTS config
  createUserTtsConfig: USER_TTS_CONFIG,
  deleteUserTtsConfig: USER_TTS_CONFIG,
  getUserTtsConfig: USER_TTS_CONFIG,
  listUserTtsConfigs: USER_TTS_CONFIG,
  updateUserTtsConfig: USER_TTS_CONFIG,

  // User model override
  clearDefaultModelConfig: USER_MODEL_OVERRIDE,
  deleteModelOverride: USER_MODEL_OVERRIDE,
  getDefaultModelConfig: USER_MODEL_OVERRIDE,
  listModelOverrides: USER_MODEL_OVERRIDE,
  setDefaultModelConfig: USER_MODEL_OVERRIDE,
  setModelOverride: USER_MODEL_OVERRIDE,

  // User STT override
  clearSttDefaultProvider: USER_STT_OVERRIDE,
  getSttDefaultProvider: USER_STT_OVERRIDE,
  setSttDefaultProvider: USER_STT_OVERRIDE,

  // User TTS override
  clearTtsDefaultConfig: USER_TTS_OVERRIDE,
  deleteTtsOverride: USER_TTS_OVERRIDE,
  getTtsDefaultConfig: USER_TTS_OVERRIDE,
  listTtsOverrides: USER_TTS_OVERRIDE,
  setTtsDefaultConfig: USER_TTS_OVERRIDE,
  setTtsOverride: USER_TTS_OVERRIDE,

  // User personality
  createPersonality: '../user/personality/create.js',
  deletePersonality: '../user/personality/delete.js',
  getPersonality: '../user/personality/get.js',
  listPersonalities: '../user/personality/list.js',
  setPersonalityVisibility: '../user/personality/visibility.js',
  updatePersonality: '../user/personality/update.js',

  // User persona
  clearPersonaOverride: USER_PERSONA_OVERRIDE,
  createPersona: USER_PERSONA_CRUD,
  createPersonaOverride: USER_PERSONA_OVERRIDE,
  deletePersona: USER_PERSONA_CRUD,
  getPersona: USER_PERSONA_CRUD,
  getPersonaOverride: USER_PERSONA_OVERRIDE,
  listPersonaOverrides: USER_PERSONA_OVERRIDE,
  listPersonas: USER_PERSONA_CRUD,
  setPersonaDefault: '../user/persona/default.js',
  setPersonaOverride: USER_PERSONA_OVERRIDE,
  updatePersona: USER_PERSONA_CRUD,

  // User other
  getTimezone: USER_TIMEZONE,
  setTimezone: USER_TIMEZONE,
  getNotificationPrefs: USER_NOTIFICATIONS,
  updateNotificationPrefs: USER_NOTIFICATIONS,
  listReleaseDms: USER_NOTIFICATIONS,
  markReleaseDmsDeleted: USER_NOTIFICATIONS,
  broadcast: ADMIN_BROADCAST,
  releaseBroadcastPending: INTERNAL_RELEASE_BROADCAST,
  releaseBroadcastDeliveries: INTERNAL_RELEASE_BROADCAST,
  releaseBroadcastReconcile: '../internal/releaseReconcile.js',
  getUserUsage: '../user/usage.js',
  getVoiceResolution: '../user/voice-resolution.js',
  getNsfwStatus: '../user/nsfw.js',
  verifyNsfw: '../user/nsfw.js',

  // User history
  clearHistory: USER_HISTORY,
  undoHistory: USER_HISTORY,
  getHistoryStats: USER_HISTORY,
  hardDeleteHistory: USER_HISTORY,

  // User voices
  listVoices: USER_VOICES,
  listVoiceModels: USER_VOICES,
  clearVoices: USER_VOICES,
  deleteVoice: USER_VOICES,

  // User memory (incognito mode)
  getIncognitoStatus: USER_MEMORY_INCOGNITO,
  enableIncognito: USER_MEMORY_INCOGNITO,
  disableIncognito: USER_MEMORY_INCOGNITO,
  incognitoForget: USER_MEMORY_INCOGNITO,

  // User memory (fresh mode)
  getFreshStatus: USER_MEMORY_FRESH,
  enableFresh: USER_MEMORY_FRESH,
  disableFresh: USER_MEMORY_FRESH,

  // User memory (stats — handler in memory.ts)
  getStats: USER_MEMORY,

  // User memory (list + search)
  list: USER_MEMORY_LIST,
  search: USER_MEMORY_SEARCH,

  // User memory (batch operations — preview-token handshake)
  batchDeletePreview: USER_MEMORY_BATCH,
  batchDelete: USER_MEMORY_BATCH,
  issuePurgeToken: USER_MEMORY_BATCH,
  purge: USER_MEMORY_BATCH,

  // User memory (single CRUD)
  getMemory: USER_MEMORY_SINGLE,
  updateMemory: USER_MEMORY_SINGLE,
  deleteMemory: USER_MEMORY_SINGLE,
  setMemoryLock: USER_MEMORY_SINGLE,

  // User memory facts (correction slice)
  listFacts: USER_MEMORY_FACTS,
  getFact: USER_MEMORY_FACTS,
  correctFact: USER_MEMORY_FACTS,
  forgetFact: USER_MEMORY_FACTS,
  setFactLock: USER_MEMORY_FACTS,

  // User config-overrides (user-tier endpoints)
  resolveUserDefaults: USER_CONFIG_OVERRIDES,
  getUserDefaults: USER_CONFIG_OVERRIDES,
  updateUserDefaults: USER_CONFIG_OVERRIDES,
  clearUserDefaults: USER_CONFIG_OVERRIDES,
  resolveCascade: USER_CONFIG_OVERRIDES,
  updatePersonalityOverrides: USER_CONFIG_OVERRIDES,
  clearPersonalityOverrides: USER_CONFIG_OVERRIDES,

  // User config-overrides (personality-tier endpoints — separate file)
  resolvePersonalityCascade: USER_PERSONALITY_CONFIG_OVERRIDES,
  updatePersonalityConfigDefaults: USER_PERSONALITY_CONFIG_OVERRIDES,

  // User shapes.inc BYOK
  storeShapesAuth: USER_SHAPES_AUTH,
  deleteShapesAuth: USER_SHAPES_AUTH,
  getShapesAuthStatus: USER_SHAPES_AUTH,
  listShapes: USER_SHAPES_LIST,
  startShapesImport: USER_SHAPES_IMPORT,
  listShapesImportJobs: USER_SHAPES_IMPORT,
  startShapesExport: USER_SHAPES_EXPORT,
  listShapesExportJobs: USER_SHAPES_EXPORT,
  startAccountExport: USER_ACCOUNT_EXPORT,
  getAccountExportStatus: USER_ACCOUNT_EXPORT,
  previewAccountDelete: USER_ACCOUNT_DELETE,
  issueAccountDeleteToken: USER_ACCOUNT_DELETE,
  deleteAccount: USER_ACCOUNT_DELETE,
  submitFeedback: USER_FEEDBACK,

  // Wallet
  listWalletKeys: '../wallet/listKeys.js',
  removeWalletKey: '../wallet/removeKey.js',
  setWalletKey: '../wallet/setKey.js',
  testWalletKey: '../wallet/testKey.js',
};

/**
 * Override the default `handle{PascalCase(id)}` export name for routes that
 * share an implementation with another route (so duplicate exports / unused-
 * alias false-positives can be avoided). Each key is the route id whose
 * default-derived export name should be replaced by the value.
 *
 * `getChannelSettings` (internal) shares its handler with the user-tier
 * `getUserChannel` route — both mount the same implementation, differentiated
 * only by the audience-level middleware applied at the prefix.
 *
 * `getAdminSettingsInternal` (internal) shares the admin-tier
 * `getAdminSettings` handler: the service-read alias and the owner read both
 * mount `handleGetAdminSettings`, differentiated only by the prefix's auth.
 */
const EXPORT_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  getChannelSettings: 'handleGetUserChannel',
  getAdminSettingsInternal: 'handleGetAdminSettings',
};

/**
 * Resolves a manifest route id to its handler's import path.
 *
 * @throws if the id is not in the map — the codegen needs every route to have
 *   a handler; a missing entry is a contract violation worth failing loudly.
 */
export function handlerPathFor(routeId: string): string {
  const path = PATH_MAP[routeId];
  if (path === undefined) {
    throw new Error(
      `handlerPathFor: no source file mapped for route id "${routeId}". ` +
        `Add an entry to PATH_MAP in packages/tooling/src/codegen/handler-paths.ts.`
    );
  }
  return path;
}

/**
 * Returns the symbol name to import for a given route id. By default this is
 * `handle{PascalCase(id)}`, but a few routes share their implementation with
 * a sibling route — `EXPORT_NAME_OVERRIDES` short-circuits those.
 */
export function handlerExportNameFor(routeId: string): string {
  return EXPORT_NAME_OVERRIDES[routeId] ?? `handle${capitalizeFirst(routeId)}`;
}

/** Exposed for the test suite to verify the map covers every manifest id. */
export const HANDLER_PATH_MAP = PATH_MAP;
/** Exposed for the test suite to verify alias names line up with sources. */
export const HANDLER_EXPORT_NAME_OVERRIDES = EXPORT_NAME_OVERRIDES;
