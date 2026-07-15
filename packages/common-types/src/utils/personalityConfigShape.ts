/**
 * UserPersonalityConfig is a shared anchor row across several override
 * "slices" (persona, LLM config, vision config, TTS config, and the
 * config-overrides JSONB). Each override route sets/clears its own slice on
 * the same row. When every slice is null the row is a dead anchor — it
 * resolves to nothing in the cascade and only clutters exports.
 *
 * This is the single source of truth for "which fields count as slices" so
 * the write-path prune (api-gateway clear routes) and the export filter
 * (ai-worker assembler) can never disagree on what "empty" means.
 */

/** The nullable override slices whose all-null state makes the anchor dead. */
export interface PersonalityConfigSlices {
  personaId: string | null;
  llmConfigId: string | null;
  visionConfigId: string | null;
  ttsConfigId: string | null;
  configOverrides: unknown;
}

/** True when every override slice is null — a dead anchor row. */
export function isEmptyPersonalityConfig(row: PersonalityConfigSlices): boolean {
  return (
    row.personaId === null &&
    row.llmConfigId === null &&
    row.visionConfigId === null &&
    row.ttsConfigId === null &&
    row.configOverrides === null
  );
}
