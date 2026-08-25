/**
 * Account export content schemas — core sections.
 *
 * Zod schemas describing the JSON file CONTENTS of an account export
 * artifact (the ZIP `buildAccountExportFiles` in
 * `services/ai-worker/src/jobs/AccountExportFiles.ts` produces). This module
 * covers `personality-directory.json`, `profile.json`, `personas/*.json`,
 * `characters/*.json`, `conversations/*.json`, `memories/*.json`,
 * `facts/*.json`, `feedback.json`, and `usage-summary.json`. The
 * config/account/telemetry sections live in sibling modules
 * (`accountExportConfigSchemas.ts`, `accountExportAccountSchemas.ts`);
 * `accountExportManifest.ts` maps each artifact path to the schema that
 * validates it. Consumers import from these source modules directly — there
 * is deliberately no composing barrel.
 *
 * Every object schema below is `.strict()` — Zod objects strip unknown keys
 * by default, which is NOT enough for a drift guard. `.strict()` makes an
 * unknown key a PARSE ERROR, so a field added to the assembler
 * (`AccountExportAssembler.ts`) without a matching schema update here fails
 * the export-path smoke loudly instead of silently passing an
 * under-specified artifact.
 *
 * `DateTime` columns are serialized by `JSON.stringify` as ISO 8601 strings
 * (never `z.date()`); `Json` columns are `z.unknown()`; nullable Prisma
 * columns return `null` (never `undefined`), so every optional field below
 * is `.nullable()`, not `.optional()`.
 */

import { z } from 'zod';

// ============================================================================
// personality-directory.json — PersonalityDirectoryEntry[]
// ============================================================================

export const PersonalityDirectoryEntrySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  })
  .strict();

export const PersonalityDirectorySchema = z.array(PersonalityDirectoryEntrySchema);

// ============================================================================
// profile.json — PROFILE_SELECT fields of `users`, minus `isSuperuser`
// (stripped before serialization in `assembleAccountExport`).
// ============================================================================

export const ExportProfileSchema = z
  .object({
    discordId: z.string(),
    username: z.string(),
    timezone: z.string(),
    nsfwVerified: z.boolean(),
    nsfwVerifiedAt: z.string().nullable(),
    notifyEnabled: z.boolean(),
    notifyLevel: z.enum(['major', 'minor', 'patch']),
    createdAt: z.string(),
    /** JSONB config-cascade defaults (user tier); null when never set. */
    configDefaults: z.unknown().nullable(),
  })
  .strict();

// ============================================================================
// personas/*.json — one full Persona row per file
// ============================================================================

export const ExportPersonaSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    content: z.string(),
    preferredName: z.string().nullable(),
    pronouns: z.string().nullable(),
    ownerId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

// ============================================================================
// characters/*.json — one full Personality row per file, minus the binary
// columns (`avatarData`, `voiceReferenceData`) the assembler omits.
// ============================================================================

export const ExportCharacterSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    displayName: z.string().nullable(),
    slug: z.string(),
    systemPromptId: z.string().nullable(),
    ownerId: z.string(),
    characterInfo: z.string(),
    personalityTraits: z.string(),
    personalityTone: z.string().nullable(),
    personalityAge: z.string().nullable(),
    personalityAppearance: z.string().nullable(),
    personalityLikes: z.string().nullable(),
    personalityDislikes: z.string().nullable(),
    conversationalGoals: z.string().nullable(),
    conversationalExamples: z.string().nullable(),
    customFields: z.unknown().nullable(),
    errorMessage: z.string().nullable(),
    birthMonth: z.number().int().nullable(),
    birthDay: z.number().int().nullable(),
    birthYear: z.number().int().nullable(),
    isPublic: z.boolean(),
    definitionPublic: z.boolean(),
    voiceEnabled: z.boolean(),
    voiceSettings: z.unknown().nullable(),
    imageEnabled: z.boolean(),
    imageSettings: z.unknown().nullable(),
    voiceReferenceType: z.string().nullable(),
    configDefaults: z.unknown().nullable(),
    originalOwnerDiscordId: z.string().nullable(),
    tags: z.array(z.string()),
    rosterBlurb: z.string().nullable(),
    rosterBlurbSourceHash: z.string().nullable(),
    cardSourceHash: z.string().nullable(),
    rosterBlurbAttempts: z.number().int(),
    rosterBlurbLastFailedAt: z.string().nullable(),
    rosterBlurbFailedSourceHash: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

// ============================================================================
// conversations/*.json — array of full ConversationHistory rows, foldered
// by character slug.
// ============================================================================

export const ExportConversationRowSchema = z
  .object({
    id: z.string(),
    channelId: z.string(),
    guildId: z.string().nullable(),
    personalityId: z.string(),
    personaId: z.string(),
    role: z.string(),
    content: z.string(),
    tokenCount: z.number().int().nullable(),
    discordMessageId: z.array(z.string()),
    messageMetadata: z.unknown().nullable(),
    thinkingContent: z.string().nullable(),
    deletedAt: z.string().nullable(),
    editedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

// ============================================================================
// memories/*.json — array of full Memory rows, minus `embedding`. The
// column is `Unsupported("vector")`, so the Prisma client never returns it —
// no explicit omit is needed for the "no embeddings" export note to hold.
// ============================================================================

export const ExportMemoryRowSchema = z
  .object({
    id: z.string(),
    personaId: z.string().nullable(),
    personalityId: z.string(),
    content: z.string(),
    isSummarized: z.boolean(),
    originalMessageCount: z.number().int().nullable(),
    summarizedAt: z.string().nullable(),
    sessionId: z.string().nullable(),
    canonScope: z.string().nullable(),
    summaryType: z.string().nullable(),
    channelId: z.string().nullable(),
    guildId: z.string().nullable(),
    messageIds: z.array(z.string()),
    senders: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
    legacyShapesUserId: z.string().nullable(),
    sourceSystem: z.string(),
    type: z.string(),
    isLocked: z.boolean(),
    visibility: z.string(),
    pool: z.string(),
    canonGroupId: z.string().nullable(),
    isFiction: z.boolean(),
    chunkGroupId: z.string().nullable(),
    chunkIndex: z.number().int().nullable(),
    totalChunks: z.number().int().nullable(),
  })
  .strict();

// ============================================================================
// facts/*.json — array of full MemoryFact rows, minus `embedding` (same
// Unsupported("vector") note as Memory above).
// ============================================================================

export const ExportFactRowSchema = z
  .object({
    id: z.string(),
    personalityId: z.string(),
    personaId: z.string().nullable(),
    pool: z.string(),
    canonGroupId: z.string().nullable(),
    isFiction: z.boolean(),
    visibility: z.string(),
    isLocked: z.boolean(),
    statement: z.string(),
    entityTags: z.array(z.string()),
    salience: z.number(),
    tier: z.string(),
    validFrom: z.string(),
    supersededAt: z.string().nullable(),
    supersededById: z.string().nullable(),
    forgotten: z.boolean(),
    sourceMemoryIds: z.array(z.string()),
    extractionJobId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

// ============================================================================
// feedback.json — array of full UserFeedback rows
// ============================================================================

export const ExportFeedbackRowSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    content: z.string(),
    contentHash: z.string(),
    status: z.enum(['new', 'read', 'archived']),
    createdAt: z.string(),
  })
  .strict();

// ============================================================================
// usage-summary.json — array of per-(provider, model) aggregates from
// `usageLog.groupBy`.
// ============================================================================

export const ExportUsageSummaryRowSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    _count: z.object({ _all: z.number().int() }).strict(),
    _sum: z
      .object({
        tokensIn: z.number().int().nullable(),
        tokensOut: z.number().int().nullable(),
      })
      .strict(),
  })
  .strict();
