/**
 * Account export path-layout contract.
 *
 * Mirrors `buildAccountExportFiles` in
 * `services/ai-worker/src/jobs/AccountExportFiles.ts` — the ZIP path rules
 * for every section, independently re-derived here so the export-path
 * smoke can assert the actual artifact's manifest against an expectation
 * built from a source-DB snapshot rather than against the assembler's own
 * output.
 */

import { z } from 'zod';
import {
  ExportCharacterSchema,
  ExportConversationRowSchema,
  ExportFactRowSchema,
  ExportFeedbackRowSchema,
  ExportMemoryRowSchema,
  ExportPersonaSchema,
  ExportProfileSchema,
  ExportUsageSummaryRowSchema,
  PersonalityDirectorySchema,
} from './accountExportCoreSchemas.js';
import {
  ExportLlmConfigRowSchema,
  ExportTtsConfigRowSchema,
  ExportUserDefaultsSchema,
  ExportUserPersonaHistoryConfigRowSchema,
  ExportUserPersonalityConfigRowSchema,
} from './accountExportConfigSchemas.js';
import {
  ExportAdminSettingsSchema,
  ExportApiKeyMetadataRowSchema,
  ExportCommandEventRowSchema,
  ExportCredentialMetadataRowSchema,
  ExportJobsFileSchema,
  ExportReleaseDeliveryLogRowSchema,
  ExportShapesPersonaMappingRowSchema,
} from './accountExportAccountSchemas.js';

/**
 * Filename stem from user-controlled text (persona names, slugs).
 *
 * Byte-identical to `sanitizeFileStem` in
 * `services/ai-worker/src/jobs/exportZip.ts` — deliberately a
 * SECOND implementation of that rule rather than an import (this package
 * has no dependency on ai-worker). A divergence between the two surfaces as
 * a manifest finding in the export-path smoke (an expected path the real
 * artifact doesn't have, or vice versa) rather than passing silently; that
 * is the intended guard, not an accident of duplication.
 */
export function sanitizeExportFileStem(stem: string): string {
  const sanitized = stem.replace(/[^\w.-]/g, '_');
  return sanitized === '' ? 'unnamed' : sanitized;
}

/** Every path `buildAccountExportFiles` writes unconditionally. */
export const ACCOUNT_EXPORT_FIXED_PATHS: readonly string[] = [
  'README.md',
  'personality-directory.json',
  'profile.json',
  'profile.md',
  'feedback.json',
  'feedback.md',
  'usage-summary.json',
  'usage-summary.md',
  'configs/llm.json',
  'configs/tts.json',
  'configs/personality-overrides.json',
  'configs/persona-history.json',
  'configs/user-defaults.json',
  'account/api-key-metadata.json',
  'account/credential-metadata.json',
  'account/jobs.json',
  'account/release-deliveries.json',
  'account/shapes-mappings.json',
  'telemetry/command-events.json',
];

/**
 * Written only when `data.adminSettings !== null` — the owner IS the admin,
 * so only the superuser's export includes the global admin-settings row.
 */
export const ACCOUNT_EXPORT_SUPERUSER_ONLY_PATHS = ['account/admin-settings.json'] as const;

export interface ExpectedExportManifestInput {
  /** Parsed personality-directory.json — supplies id → slug for the foldered sections. */
  directory: readonly { id: string; name: string; slug: string }[];
  /** From the source-DB snapshot: the personas whose files must exist. */
  personas: readonly { id: string; name: string }[];
  /** From the source-DB snapshot: owned + co-owned characters. */
  characters: readonly { id: string; slug: string }[];
  /** personalityId → row count, from the source DB. Only ids with count > 0 get files. */
  conversationCountsByPersonalityId: Readonly<Record<string, number>>;
  memoryCountsByPersonalityId: Readonly<Record<string, number>>;
  factCountsByPersonalityId: Readonly<Record<string, number>>;
  /** The sentinel is not a superuser, so this is false for the smoke. */
  isSuperuser: boolean;
}

export interface ExpectedExportManifest {
  required: string[];
  forbidden: string[];
}

function sortedUnique(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort();
}

function personaPaths(personas: ExpectedExportManifestInput['personas']): string[] {
  return personas.flatMap(persona => {
    const stem = `${sanitizeExportFileStem(persona.name)}-${persona.id.slice(0, 8)}`;
    return [`personas/${stem}.json`, `personas/${stem}.md`];
  });
}

function characterPaths(characters: ExpectedExportManifestInput['characters']): string[] {
  return characters.flatMap(character => {
    const stem = sanitizeExportFileStem(character.slug);
    return [`characters/${stem}.json`, `characters/${stem}.md`];
  });
}

/**
 * The folder stem a character-scoped section (`conversations/`, `memories/`,
 * `facts/`) uses for one personality: its directory slug, sanitized, with the
 * same `unknown-<id8>` fallback `buildAccountExportFiles` applies when a
 * referenced id is missing from the directory.
 *
 * Exported because the validator's count checks must resolve a stem the SAME
 * way this module's expected-path builder does — two independent derivations
 * that drifted would make the manifest expect one path while the count check
 * looked for another, producing contradictory findings rather than a real one.
 */
export function folderedStem(
  directory: ExpectedExportManifestInput['directory'],
  personalityId: string
): string {
  const entry = directory.find(item => item.id === personalityId);
  return sanitizeExportFileStem(entry?.slug ?? `unknown-${personalityId.slice(0, 8)}`);
}

function folderedSectionPaths(
  folder: string,
  directory: ExpectedExportManifestInput['directory'],
  countsByPersonalityId: Readonly<Record<string, number>>
): string[] {
  return Object.entries(countsByPersonalityId)
    .filter(([, count]) => count > 0)
    .flatMap(([personalityId]) => {
      const stem = folderedStem(directory, personalityId);
      return [`${folder}/${stem}.json`, `${folder}/${stem}.md`];
    });
}

/**
 * Builds the { required, forbidden } path expectation for one account
 * export, from a source-DB snapshot. Path rules mirror
 * `buildAccountExportFiles` exactly — see the module docstring.
 *
 * Two different personalityIds can sanitize to the same stem (a slug
 * collision after sanitization); `sortedUnique` dedupes the result so that
 * case doesn't produce a spurious "duplicate expected path" finding.
 */
export function buildExpectedExportManifest(
  input: ExpectedExportManifestInput
): ExpectedExportManifest {
  const derived = [
    ...personaPaths(input.personas),
    ...characterPaths(input.characters),
    ...folderedSectionPaths(
      'conversations',
      input.directory,
      input.conversationCountsByPersonalityId
    ),
    ...folderedSectionPaths('memories', input.directory, input.memoryCountsByPersonalityId),
    ...folderedSectionPaths('facts', input.directory, input.factCountsByPersonalityId),
  ];

  const required = sortedUnique([
    ...ACCOUNT_EXPORT_FIXED_PATHS,
    ...derived,
    ...(input.isSuperuser ? ACCOUNT_EXPORT_SUPERUSER_ONLY_PATHS : []),
  ]);
  const forbidden = sortedUnique(input.isSuperuser ? [] : [...ACCOUNT_EXPORT_SUPERUSER_ONLY_PATHS]);

  return { required, forbidden };
}

/** Any Zod schema — the return type of `resolveExportSchemaForPath`. */
type ExportContentSchema = z.ZodType;

const EXACT_PATH_SCHEMAS: ReadonlyMap<string, ExportContentSchema> = new Map<
  string,
  ExportContentSchema
>([
  ['personality-directory.json', PersonalityDirectorySchema],
  ['profile.json', ExportProfileSchema],
  ['feedback.json', z.array(ExportFeedbackRowSchema)],
  ['usage-summary.json', z.array(ExportUsageSummaryRowSchema)],
  ['configs/llm.json', z.array(ExportLlmConfigRowSchema)],
  ['configs/tts.json', z.array(ExportTtsConfigRowSchema)],
  ['configs/personality-overrides.json', z.array(ExportUserPersonalityConfigRowSchema)],
  ['configs/persona-history.json', z.array(ExportUserPersonaHistoryConfigRowSchema)],
  ['configs/user-defaults.json', ExportUserDefaultsSchema],
  ['account/api-key-metadata.json', z.array(ExportApiKeyMetadataRowSchema)],
  ['account/credential-metadata.json', z.array(ExportCredentialMetadataRowSchema)],
  ['account/jobs.json', ExportJobsFileSchema],
  ['account/release-deliveries.json', z.array(ExportReleaseDeliveryLogRowSchema)],
  ['account/shapes-mappings.json', z.array(ExportShapesPersonaMappingRowSchema)],
  ['telemetry/command-events.json', z.array(ExportCommandEventRowSchema)],
  ['account/admin-settings.json', ExportAdminSettingsSchema],
]);

const PREFIX_PATH_SCHEMAS: readonly { prefix: string; schema: ExportContentSchema }[] = [
  { prefix: 'personas/', schema: ExportPersonaSchema },
  { prefix: 'characters/', schema: ExportCharacterSchema },
  { prefix: 'conversations/', schema: z.array(ExportConversationRowSchema) },
  { prefix: 'memories/', schema: z.array(ExportMemoryRowSchema) },
  { prefix: 'facts/', schema: z.array(ExportFactRowSchema) },
];

/**
 * Maps a `.json` path in the export artifact to its Part-A content schema:
 * exact match for the fixed/config/account paths, prefix match for the
 * per-character-folder sections. Returns `undefined` for an unrecognized
 * path so the validator can report it as its own finding rather than
 * throwing.
 */
export function resolveExportSchemaForPath(path: string): ExportContentSchema | undefined {
  const exact = EXACT_PATH_SCHEMAS.get(path);
  if (exact !== undefined) {
    return exact;
  }
  return PREFIX_PATH_SCHEMAS.find(entry => path.startsWith(entry.prefix))?.schema;
}
