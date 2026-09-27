/**
 * Character import payload mapping — the single shared translation from a
 * character-card JSON object to the api-gateway create/update payload shape.
 *
 * Two callers build the exact same payload from the exact same card format:
 * the Discord `/character import` command (`bot-client/commands/character/import.ts`)
 * and the `pnpm ops characters:import` bulk tool. Both need the field mapping,
 * the isPublic/definitionPublic defaulting, and the attachment-wins-over-JSON
 * precedence to stay identical, so it lives here once instead of forking.
 */

import { PersonalityCreateSchema } from '../schemas/api/personality.js';

/**
 * Build API payload from parsed character data
 */
export function buildImportPayload(
  data: Record<string, unknown>,
  normalizedSlug: string,
  avatarData: string | undefined,
  voiceReferenceData: string | undefined
): Record<string, unknown> {
  const isPublic = typeof data.isPublic === 'boolean' ? data.isPublic : false;
  // Absent in the JSON → private internals (the safe default for a shared file).
  const definitionPublic =
    typeof data.definitionPublic === 'boolean' ? data.definitionPublic : false;
  // Attachment wins over the JSON field; fall back to the JSON payload's own
  // embedded data if the user didn't attach one. Same precedence for both media.
  const finalAvatarData =
    avatarData ?? (typeof data.avatarData === 'string' ? data.avatarData : undefined);
  const finalVoiceData =
    voiceReferenceData ??
    (typeof data.voiceReferenceData === 'string' ? data.voiceReferenceData : undefined);

  return {
    name: data.name,
    slug: normalizedSlug,
    characterInfo: data.characterInfo,
    personalityTraits: data.personalityTraits,
    displayName: data.displayName ?? undefined,
    isPublic,
    definitionPublic,
    personalityTone: data.personalityTone ?? undefined,
    personalityAge: data.personalityAge ?? undefined,
    personalityAppearance: data.personalityAppearance ?? undefined,
    personalityLikes: data.personalityLikes ?? undefined,
    personalityDislikes: data.personalityDislikes ?? undefined,
    conversationalGoals: data.conversationalGoals ?? undefined,
    conversationalExamples: data.conversationalExamples ?? undefined,
    customFields: data.customFields ?? undefined,
    // Accepted as an array (the export shape) or a comma-separated string;
    // the gateway schema normalizes, dedupes, and caps either form.
    tags: data.tags ?? undefined,
    avatarData: finalAvatarData,
    voiceReferenceData: finalVoiceData,
    // Enable voice whenever a reference is present. On CREATE this is stripped
    // (not in the create schema) and derived from the reference server-side; on
    // UPDATE (re-import into an existing slug) it's honored — without it, the
    // re-import would store the reference but leave voice disabled.
    voiceEnabled: finalVoiceData !== undefined ? true : undefined,
    errorMessage: data.errorMessage ?? undefined,
  };
}

/** One field-level validation problem from {@link getImportPayloadIssues}. */
export interface ImportPayloadIssue {
  /** Dot-joined Zod issue path (e.g. `slug`, `customFields.foo`). */
  field: string;
  /** The Zod issue message. */
  message: string;
}

/**
 * Validate an import payload against the api-gateway's create schema, without
 * throwing. Returns an empty array when the payload is valid.
 *
 * Shared so both import callers (the Discord command's pre-flight check and
 * the bulk CLI's per-card validation) report the same field names and
 * messages for the same bad input.
 */
export function getImportPayloadIssues(payload: Record<string, unknown>): ImportPayloadIssue[] {
  const result = PersonalityCreateSchema.safeParse(payload);
  if (result.success) {
    return [];
  }
  return result.error.issues.map(issue => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}
