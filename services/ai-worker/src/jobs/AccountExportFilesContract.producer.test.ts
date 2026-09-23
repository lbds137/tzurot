/**
 * Producer half of the ai-worker → bot-client account-export contract.
 *
 * Runs the REAL `buildAccountExportFiles()` over two fully-typed
 * `AccountExportData` fixtures (`full` — every section populated, every
 * nullable column set; `sparse` — same section coverage, every nullable
 * column null) and snapshots each `{ paths, json }` summary to a committed
 * fixture under `@tzurot/test-utils` (`fixtures/contracts/account-export/`).
 * `--update` regenerates; CI COMPARES (strict). Drift in the producer's file
 * shape → CI fails here instead of the weekly export-path smoke.
 *
 * Every row is typed against the assembler's real exported types (or, for
 * the `unknown[]` ancillary sections, the exact Prisma payload type the
 * assembler's query returns) via `satisfies`, so a new Prisma column breaks
 * `typecheck:spec` rather than silently missing this fixture.
 *
 * The consumer half (`tests/e2e/contracts/AccountExportFiles.contract.test.ts`)
 * reads the SAME fixtures and validates every `.json` entry against the
 * manifest's `resolveExportSchemaForPath` table — the same lookup the
 * bot-client export-path smoke uses.
 */

import { describe, it, expect } from 'vitest';
import { contractFixtureFile, stableFixtureJson } from '@tzurot/test-utils';
import type { Prisma } from '@tzurot/common-types/services/prisma';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  EXPORT_NOTES,
  type AccountExportData,
  type ExportProfile,
  type ExportPersona,
  type ExportPersonaDigest,
  type ExportCharacter,
  type ExportConversationRow,
  type ExportMemoryRow,
  type ExportFactRow,
  type ExportFeedbackRow,
  type ExportUsageSummaryRow,
  type ExportAdminSettings,
  type PersonalityDirectoryEntry,
} from './AccountExportAssembler.js';
import { buildAccountExportFiles } from './AccountExportFiles.js';

const NOW = new Date('2026-01-15T00:00:00.000Z');

const USER_ID = '10000000-0000-4000-8000-000000000001';
const PERSONA_A_ID = '20000000-0000-4000-8000-000000000001';
const PERSONA_B_ID = '20000000-0000-4000-8000-000000000002';
const CHARACTER_ID = '30000000-0000-4000-8000-000000000001';
const CHARACTER_2_ID = '30000000-0000-4000-8000-000000000002';
const LLM_CONFIG_ID = '40000000-0000-4000-8000-000000000001';
const TTS_CONFIG_ID = '40000000-0000-4000-8000-000000000002';
const CONVERSATION_ID = '50000000-0000-4000-8000-000000000001';
const MEMORY_ID = '50000000-0000-4000-8000-000000000002';
const FACT_ID = '50000000-0000-4000-8000-000000000003';
const FEEDBACK_ID = '50000000-0000-4000-8000-000000000004';
const USER_PERSONALITY_CONFIG_ID = '60000000-0000-4000-8000-000000000001';
const USER_PERSONA_HISTORY_CONFIG_ID = '60000000-0000-4000-8000-000000000002';
const API_KEY_ID = '60000000-0000-4000-8000-000000000003';
const CREDENTIAL_ID = '60000000-0000-4000-8000-000000000004';
const IMPORT_JOB_ID = '60000000-0000-4000-8000-000000000005';
const EXPORT_JOB_ID = '60000000-0000-4000-8000-000000000006';
const RELEASE_ID = '60000000-0000-4000-8000-000000000007';
const RELEASE_DELIVERY_ID = '60000000-0000-4000-8000-000000000008';
const SHAPES_MAPPING_ID = '60000000-0000-4000-8000-000000000009';
const COMMAND_EVENT_ID = '60000000-0000-4000-8000-00000000000a';

// ============================================================================
// full.json — every section populated, every nullable column set to a value.
// ============================================================================

const FULL_DIGEST_1: ExportPersonaDigest = {
  personalityId: CHARACTER_ID,
  personalitySlug: 'azura',
  personalityName: 'azura',
  digestText: 'Recent chats covered a trip to the coast.',
  generatedAt: new Date('2026-01-10T00:00:00.000Z'),
  windowStart: new Date('2026-01-03T00:00:00.000Z'),
};

const FULL_DIGEST_2: ExportPersonaDigest = {
  personalityId: CHARACTER_2_ID,
  personalitySlug: 'nyx',
  personalityName: 'Nyx',
  digestText: 'No recent activity summarized yet.',
  generatedAt: null,
  windowStart: null,
};

const FULL_PERSONA_A: ExportPersona = {
  id: PERSONA_A_ID,
  name: 'Vex',
  description: 'A quiet observer.',
  content: 'Persona A about-me text.',
  preferredName: 'Vee',
  pronouns: 'she/her',
  ownerId: USER_ID,
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  updatedAt: new Date('2026-01-06T00:00:00.000Z'),
  digests: [FULL_DIGEST_1, FULL_DIGEST_2],
};

const FULL_PERSONA_B: ExportPersona = {
  id: PERSONA_B_ID,
  name: 'Orin',
  description: null,
  content: 'Persona B about-me text.',
  preferredName: null,
  pronouns: null,
  ownerId: USER_ID,
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  digests: [],
};

const FULL_CHARACTER: ExportCharacter = {
  id: CHARACTER_ID,
  name: 'azura',
  displayName: 'Azura',
  slug: 'azura',
  systemPromptId: null,
  ownerId: USER_ID,
  characterInfo: 'A sea spirit.',
  personalityTraits: 'calm, curious',
  personalityTone: 'gentle',
  personalityAge: 'ageless',
  personalityAppearance: 'blue-green eyes',
  personalityLikes: 'tide pools',
  personalityDislikes: 'loud noises',
  conversationalGoals: 'comfort the user',
  conversationalExamples: 'Example dialogue.',
  customFields: { theme: 'ocean' },
  errorMessage: null,
  birthMonth: 6,
  birthDay: 21,
  birthYear: null,
  isPublic: true,
  definitionPublic: true,
  voiceEnabled: true,
  voiceSettings: { pitch: 1 },
  imageEnabled: false,
  imageSettings: null,
  voiceReferenceType: 'sample',
  configDefaults: { maxImages: 2 },
  originalOwnerDiscordId: null,
  tags: ['fantasy', 'sea'],
  rosterBlurb: 'A calm presence by the water.',
  rosterBlurbSourceHash: 'a'.repeat(64),
  cardSourceHash: 'a'.repeat(64),
  rosterBlurbAttempts: 0,
  rosterBlurbLastFailedAt: null,
  rosterBlurbFailedSourceHash: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-08T00:00:00.000Z'),
};

const FULL_PERSONALITY_DIRECTORY: PersonalityDirectoryEntry[] = [
  { id: CHARACTER_ID, name: 'azura', slug: 'azura' },
  { id: CHARACTER_2_ID, name: 'Nyx', slug: 'nyx' },
];

const FULL_CONVERSATION: ExportConversationRow = {
  id: CONVERSATION_ID,
  channelId: '999999999999999901',
  guildId: null,
  personalityId: CHARACTER_ID,
  personaId: PERSONA_A_ID,
  role: 'user',
  content: 'Hello there!',
  tokenCount: 12,
  discordMessageId: ['888888888888888801'],
  messageMetadata: { referencedMessageId: null },
  thinkingContent: null,
  deletedAt: null,
  editedAt: null,
  createdAt: new Date('2026-01-03T00:00:00.000Z'),
  updatedAt: new Date('2026-01-03T00:00:00.000Z'),
};

const FULL_MEMORY: ExportMemoryRow = {
  id: MEMORY_ID,
  personaId: PERSONA_A_ID,
  personalityId: CHARACTER_ID,
  content: 'Remembered a trip to the coast.',
  isSummarized: true,
  originalMessageCount: 5,
  summarizedAt: new Date('2026-01-04T00:00:00.000Z'),
  sessionId: 'session-1',
  canonScope: 'default',
  summaryType: 'episodic',
  channelId: '999999999999999901',
  guildId: null,
  messageIds: ['msg-1', 'msg-2'],
  senders: [PERSONA_A_ID],
  createdAt: new Date('2026-01-04T00:00:00.000Z'),
  updatedAt: new Date('2026-01-05T00:00:00.000Z'),
  legacyShapesUserId: null,
  sourceSystem: 'tzurot-v3',
  type: 'memory',
  isLocked: false,
  visibility: 'normal',
  pool: 'private',
  canonGroupId: null,
  isFiction: false,
  chunkGroupId: null,
  chunkIndex: null,
  totalChunks: null,
  assistantSummary: 'They talked about a coastal trip.',
};

const FULL_FACT: ExportFactRow = {
  id: FACT_ID,
  personalityId: CHARACTER_ID,
  personaId: PERSONA_A_ID,
  pool: 'private',
  canonGroupId: null,
  isFiction: false,
  visibility: 'normal',
  isLocked: false,
  statement: "Vex's favorite color is teal.",
  entityTags: ['user:vex'],
  salience: 0.7,
  tier: 'observed',
  validFrom: new Date('2026-01-04T00:00:00.000Z'),
  supersededAt: null,
  supersededById: null,
  forgotten: false,
  sourceMemoryIds: [MEMORY_ID],
  extractionJobId: 'job-1',
  createdAt: new Date('2026-01-04T00:00:00.000Z'),
  updatedAt: new Date('2026-01-04T00:00:00.000Z'),
};

const FULL_FEEDBACK: ExportFeedbackRow = {
  id: FEEDBACK_ID,
  userId: USER_ID,
  content: 'Loving the bot!',
  contentHash: 'c'.repeat(64),
  status: 'new',
  createdAt: new Date('2026-01-07T00:00:00.000Z'),
};

const FULL_USAGE_SUMMARY: ExportUsageSummaryRow = {
  provider: 'openrouter',
  model: 'claude-sonnet-4',
  _count: { _all: 42 },
  _sum: { tokensIn: 1000, tokensOut: 500 },
};

const FULL_USER_PERSONALITY_CONFIG = {
  id: USER_PERSONALITY_CONFIG_ID,
  userId: USER_ID,
  personalityId: CHARACTER_ID,
  personaId: PERSONA_A_ID,
  llmConfigId: LLM_CONFIG_ID,
  visionConfigId: null,
  ttsConfigId: TTS_CONFIG_ID,
  configOverrides: { maxTokens: 2048 },
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
} satisfies Prisma.UserPersonalityConfigGetPayload<object>;

const FULL_USER_PERSONA_HISTORY_CONFIG = {
  id: USER_PERSONA_HISTORY_CONFIG_ID,
  userId: USER_ID,
  personalityId: CHARACTER_ID,
  personaId: PERSONA_A_ID,
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  lastContextReset: new Date('2026-01-05T00:00:00.000Z'),
  previousContextReset: null,
} satisfies Prisma.UserPersonaHistoryConfigGetPayload<object>;

const FULL_LLM_CONFIG = {
  id: LLM_CONFIG_ID,
  name: 'My Chat Config',
  description: 'Primary chat config.',
  ownerId: USER_ID,
  isGlobal: false,
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4',
  advancedParameters: { temperature: 0.7 },
  contextWindowTokens: 131072,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies Prisma.LlmConfigGetPayload<object>;

const FULL_TTS_CONFIG = {
  id: TTS_CONFIG_ID,
  name: 'My TTS Config',
  description: null,
  ownerId: USER_ID,
  isGlobal: false,
  isDefault: true,
  isFreeDefault: false,
  provider: 'mistral',
  modelId: 'voxtral-mini-tts-2603',
  advancedParameters: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies Prisma.TtsConfigGetPayload<object>;

const FULL_API_KEY_METADATA = {
  id: API_KEY_ID,
  provider: 'openrouter',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies Prisma.UserApiKeyGetPayload<{
  select: { id: true; provider: true; createdAt: true; updatedAt: true };
}>;

const FULL_CREDENTIAL_METADATA = {
  id: CREDENTIAL_ID,
  service: 'shapes_inc',
  credentialType: 'session_cookie',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-02-01T00:00:00.000Z'),
} satisfies Prisma.UserCredentialGetPayload<{
  select: { id: true; service: true; credentialType: true; createdAt: true; expiresAt: true };
}>;

const FULL_IMPORT_JOB = {
  id: IMPORT_JOB_ID,
  userId: USER_ID,
  personalityId: CHARACTER_ID,
  sourceSlug: 'azura-import',
  sourceService: 'shapes_inc',
  status: 'completed',
  importType: 'full',
  memoriesImported: 10,
  memoriesFailed: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  startedAt: new Date('2026-01-01T00:01:00.000Z'),
  completedAt: new Date('2026-01-01T00:05:00.000Z'),
  errorMessage: null,
  importMetadata: { rowsSeen: 12 },
} satisfies Prisma.ImportJobGetPayload<object>;

const FULL_EXPORT_JOB = {
  id: EXPORT_JOB_ID,
  userId: USER_ID,
  sourceSlug: 'azura-export',
  sourceService: 'shapes_inc',
  status: 'completed',
  format: 'json',
  fileName: 'azura-export.json',
  fileSizeBytes: 2048,
  downloadToken: 'd'.repeat(40),
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  startedAt: new Date('2026-01-02T00:01:00.000Z'),
  completedAt: new Date('2026-01-02T00:02:00.000Z'),
  expiresAt: new Date('2026-01-03T00:02:00.000Z'),
  errorMessage: null,
  exportMetadata: { rows: 42 },
} satisfies Prisma.ExportJobGetPayload<{ omit: { fileContent: true; fileData: true } }>;

const FULL_RELEASE_DELIVERY = {
  id: RELEASE_DELIVERY_ID,
  releaseId: RELEASE_ID,
  userId: USER_ID,
  status: 'sent',
  errorCode: null,
  attemptedAt: new Date('2026-01-05T00:00:00.000Z'),
  sentMessageId: '777777777777777701',
  messageDeletedAt: null,
  createdAt: new Date('2026-01-05T00:00:00.000Z'),
  updatedAt: new Date('2026-01-05T00:00:00.000Z'),
} satisfies Prisma.ReleaseDeliveryLogGetPayload<object>;

const FULL_SHAPES_MAPPING = {
  id: SHAPES_MAPPING_ID,
  shapesUserId: '10000000-0000-4000-8000-000000000099',
  personaId: PERSONA_A_ID,
  mappedAt: new Date('2026-01-01T00:00:00.000Z'),
  mappedBy: USER_ID,
  verificationStatus: 'verified',
} satisfies Prisma.ShapesPersonaMappingGetPayload<object>;

const FULL_COMMAND_EVENT = {
  id: COMMAND_EVENT_ID,
  occurredAt: new Date('2026-01-06T00:00:00.000Z'),
  userId: '111111111111111111',
  guildId: null,
  channelKind: 'dm',
  command: 'memory.browse',
  characterId: CHARACTER_ID,
  outcome: 'ok',
  errorCode: null,
  latencyMs: 120,
  context: { model_family: 'claude' },
} satisfies Prisma.CommandEventGetPayload<object>;

const FULL_PROFILE: ExportProfile = {
  discordId: '111111111111111111',
  username: 'alice',
  timezone: 'America/New_York',
  nsfwVerified: true,
  nsfwVerifiedAt: new Date('2026-01-05T00:00:00.000Z'),
  notifyEnabled: true,
  notifyLevel: 'minor',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  configDefaults: { maxImages: 4 },
};

const FULL_ADMIN_SETTINGS: ExportAdminSettings = {
  id: ADMIN_SETTINGS_SINGLETON_ID,
  updatedBy: USER_ID,
  configDefaults: { maxImages: 4 },
  systemSettings: { featureFlags: { betaVoice: true } },
  globalDefaultLlmConfigId: LLM_CONFIG_ID,
  globalDefaultVisionConfigId: null,
  freeDefaultLlmConfigId: null,
  freeDefaultVisionConfigId: null,
  globalDefaultTtsConfigId: TTS_CONFIG_ID,
  freeDefaultTtsConfigId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const FULL_DATA = {
  meta: { exportedAt: NOW.toISOString(), formatVersion: 3, notes: EXPORT_NOTES },
  profile: FULL_PROFILE,
  personas: [FULL_PERSONA_A, FULL_PERSONA_B],
  characters: [FULL_CHARACTER],
  personalityDirectory: FULL_PERSONALITY_DIRECTORY,
  conversationHistory: [FULL_CONVERSATION],
  memories: [FULL_MEMORY],
  facts: [FULL_FACT],
  personalityConfigs: [FULL_USER_PERSONALITY_CONFIG],
  personaHistoryConfigs: [FULL_USER_PERSONA_HISTORY_CONFIG],
  llmConfigs: [FULL_LLM_CONFIG],
  ttsConfigs: [FULL_TTS_CONFIG],
  apiKeyMetadata: [FULL_API_KEY_METADATA],
  credentialMetadata: [FULL_CREDENTIAL_METADATA],
  usageSummary: [FULL_USAGE_SUMMARY],
  feedback: [FULL_FEEDBACK],
  importJobs: [FULL_IMPORT_JOB],
  exportJobs: [FULL_EXPORT_JOB],
  releaseDeliveries: [FULL_RELEASE_DELIVERY],
  shapesMappings: [FULL_SHAPES_MAPPING],
  commandEvents: [FULL_COMMAND_EVENT],
  adminSettings: FULL_ADMIN_SETTINGS,
} satisfies AccountExportData;

// ============================================================================
// sparse.json — same section coverage, every nullable column null.
// ============================================================================

const SPARSE_PERSONA: ExportPersona = {
  id: PERSONA_A_ID,
  name: 'Sparse Persona',
  description: null,
  content: 'Persona content.',
  preferredName: null,
  pronouns: null,
  ownerId: USER_ID,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  digests: [],
};

const SPARSE_CHARACTER: ExportCharacter = {
  id: CHARACTER_ID,
  name: 'sparse-character',
  displayName: null,
  slug: 'sparse-character',
  systemPromptId: null,
  ownerId: USER_ID,
  characterInfo: 'Character info.',
  personalityTraits: 'Traits.',
  personalityTone: null,
  personalityAge: null,
  personalityAppearance: null,
  personalityLikes: null,
  personalityDislikes: null,
  conversationalGoals: null,
  conversationalExamples: null,
  customFields: null,
  errorMessage: null,
  birthMonth: null,
  birthDay: null,
  birthYear: null,
  isPublic: false,
  definitionPublic: false,
  voiceEnabled: false,
  voiceSettings: null,
  imageEnabled: false,
  imageSettings: null,
  voiceReferenceType: null,
  configDefaults: null,
  originalOwnerDiscordId: null,
  tags: [],
  rosterBlurb: null,
  rosterBlurbSourceHash: null,
  cardSourceHash: null,
  rosterBlurbAttempts: 0,
  rosterBlurbLastFailedAt: null,
  rosterBlurbFailedSourceHash: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const SPARSE_PERSONALITY_DIRECTORY: PersonalityDirectoryEntry[] = [
  { id: CHARACTER_ID, name: 'sparse-character', slug: 'sparse-character' },
];

const SPARSE_CONVERSATION: ExportConversationRow = {
  id: CONVERSATION_ID,
  channelId: '999999999999999901',
  guildId: null,
  personalityId: CHARACTER_ID,
  personaId: PERSONA_A_ID,
  role: 'user',
  content: 'hi',
  tokenCount: null,
  discordMessageId: [],
  messageMetadata: null,
  thinkingContent: null,
  deletedAt: null,
  editedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const SPARSE_MEMORY: ExportMemoryRow = {
  id: MEMORY_ID,
  personaId: null,
  personalityId: CHARACTER_ID,
  content: 'sparse memory',
  isSummarized: false,
  originalMessageCount: null,
  summarizedAt: null,
  sessionId: null,
  canonScope: null,
  summaryType: null,
  channelId: null,
  guildId: null,
  messageIds: [],
  senders: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  legacyShapesUserId: null,
  sourceSystem: 'tzurot-v3',
  type: 'memory',
  isLocked: false,
  visibility: 'normal',
  pool: 'private',
  canonGroupId: null,
  isFiction: false,
  chunkGroupId: null,
  chunkIndex: null,
  totalChunks: null,
  assistantSummary: null,
};

const SPARSE_FACT: ExportFactRow = {
  id: FACT_ID,
  personalityId: CHARACTER_ID,
  personaId: null,
  pool: 'private',
  canonGroupId: null,
  isFiction: false,
  visibility: 'normal',
  isLocked: false,
  statement: 'A sparse fact.',
  entityTags: [],
  salience: 0.5,
  tier: 'observed',
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  supersededAt: null,
  supersededById: null,
  forgotten: false,
  sourceMemoryIds: [],
  extractionJobId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const SPARSE_FEEDBACK: ExportFeedbackRow = {
  id: FEEDBACK_ID,
  userId: USER_ID,
  content: 'sparse feedback',
  contentHash: 'e'.repeat(64),
  status: 'new',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

const SPARSE_USAGE_SUMMARY: ExportUsageSummaryRow = {
  provider: 'openrouter',
  model: 'test-model',
  _count: { _all: 0 },
  _sum: { tokensIn: null, tokensOut: null },
};

const SPARSE_USER_PERSONALITY_CONFIG = {
  id: USER_PERSONALITY_CONFIG_ID,
  userId: USER_ID,
  personalityId: CHARACTER_ID,
  personaId: null,
  llmConfigId: null,
  visionConfigId: null,
  ttsConfigId: null,
  configOverrides: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies Prisma.UserPersonalityConfigGetPayload<object>;

const SPARSE_USER_PERSONA_HISTORY_CONFIG = {
  id: USER_PERSONA_HISTORY_CONFIG_ID,
  userId: USER_ID,
  personalityId: CHARACTER_ID,
  personaId: PERSONA_A_ID,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  lastContextReset: null,
  previousContextReset: null,
} satisfies Prisma.UserPersonaHistoryConfigGetPayload<object>;

const SPARSE_LLM_CONFIG = {
  id: LLM_CONFIG_ID,
  name: 'Sparse Config',
  description: null,
  ownerId: USER_ID,
  isGlobal: false,
  provider: 'openrouter',
  model: 'test-model',
  advancedParameters: null,
  contextWindowTokens: 131072,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies Prisma.LlmConfigGetPayload<object>;

const SPARSE_TTS_CONFIG = {
  id: TTS_CONFIG_ID,
  name: 'Sparse TTS',
  description: null,
  ownerId: USER_ID,
  isGlobal: false,
  isDefault: false,
  isFreeDefault: false,
  provider: 'self-hosted',
  modelId: null,
  advancedParameters: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies Prisma.TtsConfigGetPayload<object>;

const SPARSE_API_KEY_METADATA = {
  id: API_KEY_ID,
  provider: 'openrouter',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies Prisma.UserApiKeyGetPayload<{
  select: { id: true; provider: true; createdAt: true; updatedAt: true };
}>;

const SPARSE_CREDENTIAL_METADATA = {
  id: CREDENTIAL_ID,
  service: 'shapes_inc',
  credentialType: 'session_cookie',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: null,
} satisfies Prisma.UserCredentialGetPayload<{
  select: { id: true; service: true; credentialType: true; createdAt: true; expiresAt: true };
}>;

const SPARSE_IMPORT_JOB = {
  id: IMPORT_JOB_ID,
  userId: USER_ID,
  personalityId: null,
  sourceSlug: 'sparse-import',
  sourceService: 'shapes_inc',
  status: 'pending',
  importType: 'full',
  memoriesImported: null,
  memoriesFailed: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  startedAt: null,
  completedAt: null,
  errorMessage: null,
  importMetadata: null,
} satisfies Prisma.ImportJobGetPayload<object>;

const SPARSE_EXPORT_JOB = {
  id: EXPORT_JOB_ID,
  userId: USER_ID,
  sourceSlug: 'sparse-export',
  sourceService: 'shapes_inc',
  status: 'pending',
  format: 'json',
  fileName: null,
  fileSizeBytes: null,
  downloadToken: 'f'.repeat(40),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  startedAt: null,
  completedAt: null,
  expiresAt: new Date('2026-01-02T00:00:00.000Z'),
  errorMessage: null,
  exportMetadata: null,
} satisfies Prisma.ExportJobGetPayload<{ omit: { fileContent: true; fileData: true } }>;

const SPARSE_RELEASE_DELIVERY = {
  id: RELEASE_DELIVERY_ID,
  releaseId: RELEASE_ID,
  userId: USER_ID,
  status: 'pending',
  errorCode: null,
  attemptedAt: null,
  sentMessageId: null,
  messageDeletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies Prisma.ReleaseDeliveryLogGetPayload<object>;

const SPARSE_SHAPES_MAPPING = {
  id: SHAPES_MAPPING_ID,
  shapesUserId: '20000000-0000-4000-8000-000000000099',
  personaId: PERSONA_A_ID,
  mappedAt: new Date('2026-01-01T00:00:00.000Z'),
  mappedBy: null,
  verificationStatus: 'unverified',
} satisfies Prisma.ShapesPersonaMappingGetPayload<object>;

const SPARSE_COMMAND_EVENT = {
  id: COMMAND_EVENT_ID,
  occurredAt: new Date('2026-01-01T00:00:00.000Z'),
  userId: '222222222222222222',
  guildId: null,
  channelKind: 'dm',
  command: 'help',
  characterId: null,
  outcome: 'ok',
  errorCode: null,
  latencyMs: 5,
  context: null,
} satisfies Prisma.CommandEventGetPayload<object>;

const SPARSE_PROFILE: ExportProfile = {
  discordId: '222222222222222222',
  username: 'bob',
  timezone: 'UTC',
  nsfwVerified: false,
  nsfwVerifiedAt: null,
  notifyEnabled: false,
  notifyLevel: 'major',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  configDefaults: null,
};

const SPARSE_DATA = {
  meta: { exportedAt: NOW.toISOString(), formatVersion: 3, notes: EXPORT_NOTES },
  profile: SPARSE_PROFILE,
  personas: [SPARSE_PERSONA],
  characters: [SPARSE_CHARACTER],
  personalityDirectory: SPARSE_PERSONALITY_DIRECTORY,
  conversationHistory: [SPARSE_CONVERSATION],
  memories: [SPARSE_MEMORY],
  facts: [SPARSE_FACT],
  personalityConfigs: [SPARSE_USER_PERSONALITY_CONFIG],
  personaHistoryConfigs: [SPARSE_USER_PERSONA_HISTORY_CONFIG],
  llmConfigs: [SPARSE_LLM_CONFIG],
  ttsConfigs: [SPARSE_TTS_CONFIG],
  apiKeyMetadata: [SPARSE_API_KEY_METADATA],
  credentialMetadata: [SPARSE_CREDENTIAL_METADATA],
  usageSummary: [SPARSE_USAGE_SUMMARY],
  feedback: [SPARSE_FEEDBACK],
  importJobs: [SPARSE_IMPORT_JOB],
  exportJobs: [SPARSE_EXPORT_JOB],
  releaseDeliveries: [SPARSE_RELEASE_DELIVERY],
  shapesMappings: [SPARSE_SHAPES_MAPPING],
  commandEvents: [SPARSE_COMMAND_EVENT],
  adminSettings: null,
} satisfies AccountExportData;

const FIXTURES = [['full', FULL_DATA] as const, ['sparse', SPARSE_DATA] as const];

describe('Contract producer: account-export ZIP files (real buildAccountExportFiles output)', () => {
  it.each(FIXTURES)(
    'captures the %s artifact as the committed contract fixture',
    async (name, data) => {
      const files = buildAccountExportFiles(data);
      const jsonPaths = Object.keys(files)
        .filter(path => path.endsWith('.json'))
        .sort();
      const payload = {
        paths: Object.keys(files).sort(),
        json: Object.fromEntries(jsonPaths.map(path => [path, JSON.parse(files[path])])),
      };

      await expect(stableFixtureJson(payload)).toMatchFileSnapshot(
        contractFixtureFile(`account-export/${name}.json`)
      );
    }
  );
});
