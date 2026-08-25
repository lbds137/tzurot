/**
 * Account export content schemas — `configs/*.json` sections.
 *
 * Sibling of `accountExportCoreSchemas.ts`; see that module's docstring for
 * the `.strict()` drift-guard rationale and the DateTime/Json serialization
 * rules this file also follows.
 */

import { z } from 'zod';

// ============================================================================
// configs/llm.json — array of full LlmConfig rows
// ============================================================================

export const ExportLlmConfigRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    ownerId: z.string(),
    isGlobal: z.boolean(),
    provider: z.string(),
    model: z.string(),
    advancedParameters: z.unknown().nullable(),
    contextWindowTokens: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

// ============================================================================
// configs/tts.json — array of full TtsConfig rows
// ============================================================================

export const ExportTtsConfigRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    ownerId: z.string(),
    isGlobal: z.boolean(),
    isDefault: z.boolean(),
    isFreeDefault: z.boolean(),
    provider: z.string(),
    modelId: z.string().nullable(),
    advancedParameters: z.unknown().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

// ============================================================================
// configs/personality-overrides.json — array of full UserPersonalityConfig
// rows (dead anchor rows already filtered by the assembler).
// ============================================================================

export const ExportUserPersonalityConfigRowSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    personalityId: z.string(),
    personaId: z.string().nullable(),
    llmConfigId: z.string().nullable(),
    visionConfigId: z.string().nullable(),
    ttsConfigId: z.string().nullable(),
    configOverrides: z.unknown().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

// ============================================================================
// configs/persona-history.json — array of full UserPersonaHistoryConfig rows
// ============================================================================

export const ExportUserPersonaHistoryConfigRowSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    personalityId: z.string(),
    personaId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastContextReset: z.string().nullable(),
    previousContextReset: z.string().nullable(),
  })
  .strict();

// ============================================================================
// configs/user-defaults.json — `data.profile.configDefaults ?? null`.
// A Json column (or null); the file is literally `null` when the user has
// set no personal config-cascade defaults.
// ============================================================================

export const ExportUserDefaultsSchema = z.unknown().nullable();
