/**
 * Account export content schemas — `account/*.json` and
 * `telemetry/command-events.json` sections.
 *
 * Sibling of `accountExportCoreSchemas.ts`; see that module's docstring for
 * the `.strict()` drift-guard rationale and the DateTime/Json serialization
 * rules this file also follows.
 */

import { z } from 'zod';

// ============================================================================
// account/api-key-metadata.json — explicit select from the assembler
// (id, provider, createdAt, updatedAt) — never the encrypted iv/content/tag.
// ============================================================================

export const ExportApiKeyMetadataRowSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

// ============================================================================
// account/credential-metadata.json — explicit select from the assembler
// (id, service, credentialType, createdAt, expiresAt) — never iv/content/tag.
// ============================================================================

export const ExportCredentialMetadataRowSchema = z
  .object({
    id: z.string(),
    service: z.string(),
    credentialType: z.string(),
    createdAt: z.string(),
    expiresAt: z.string().nullable(),
  })
  .strict();

// ============================================================================
// account/jobs.json — { importJobs: ImportJob[], exportJobs: ExportJob[] }
// exportJobs omit `fileContent` and `fileData` (the stored payload columns).
// ============================================================================

export const ExportImportJobRowSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    personalityId: z.string().nullable(),
    sourceSlug: z.string(),
    sourceService: z.string(),
    status: z.string(),
    importType: z.string(),
    memoriesImported: z.number().int().nullable(),
    memoriesFailed: z.number().int().nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    errorMessage: z.string().nullable(),
    importMetadata: z.unknown().nullable(),
  })
  .strict();

export const ExportExportJobRowSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    sourceSlug: z.string(),
    sourceService: z.string(),
    status: z.string(),
    format: z.string(),
    fileName: z.string().nullable(),
    fileSizeBytes: z.number().int().nullable(),
    downloadToken: z.string(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    expiresAt: z.string(),
    errorMessage: z.string().nullable(),
    exportMetadata: z.unknown().nullable(),
  })
  .strict();

export const ExportJobsFileSchema = z
  .object({
    importJobs: z.array(ExportImportJobRowSchema),
    exportJobs: z.array(ExportExportJobRowSchema),
  })
  .strict();

// ============================================================================
// account/release-deliveries.json — array of full ReleaseDeliveryLog rows
// ============================================================================

export const ExportReleaseDeliveryLogRowSchema = z
  .object({
    id: z.string(),
    releaseId: z.string(),
    userId: z.string(),
    status: z.enum(['pending', 'sent', 'failed_transient', 'failed_permanent', 'failed_bot_level']),
    errorCode: z.string().nullable(),
    attemptedAt: z.string().nullable(),
    sentMessageId: z.string().nullable(),
    messageDeletedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

// ============================================================================
// account/shapes-mappings.json — array of full ShapesPersonaMapping rows
// ============================================================================

export const ExportShapesPersonaMappingRowSchema = z
  .object({
    id: z.string(),
    shapesUserId: z.string(),
    personaId: z.string(),
    mappedAt: z.string(),
    mappedBy: z.string().nullable(),
    verificationStatus: z.string(),
  })
  .strict();

// ============================================================================
// telemetry/command-events.json — array of full CommandEvent rows
// ============================================================================

export const ExportCommandEventRowSchema = z
  .object({
    id: z.string(),
    occurredAt: z.string(),
    userId: z.string(),
    guildId: z.string().nullable(),
    channelKind: z.string(),
    command: z.string(),
    characterId: z.string().nullable(),
    outcome: z.string(),
    errorCode: z.string().nullable(),
    latencyMs: z.number().int(),
    context: z.unknown().nullable(),
  })
  .strict();

// ============================================================================
// account/admin-settings.json — a single full AdminSettings row.
// Superuser-only: present only when the exporting user is the superuser.
// ============================================================================

export const ExportAdminSettingsSchema = z
  .object({
    id: z.string(),
    updatedBy: z.string().nullable(),
    configDefaults: z.unknown().nullable(),
    systemSettings: z.unknown().nullable(),
    globalDefaultLlmConfigId: z.string().nullable(),
    globalDefaultVisionConfigId: z.string().nullable(),
    freeDefaultLlmConfigId: z.string().nullable(),
    freeDefaultVisionConfigId: z.string().nullable(),
    globalDefaultTtsConfigId: z.string().nullable(),
    freeDefaultTtsConfigId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
