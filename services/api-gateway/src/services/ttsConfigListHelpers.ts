/**
 * Pure list-shaping helpers for `TtsConfigService`.
 *
 * Mirrors `llmConfigListHelpers.ts`: default-ness derives from the AdminSettings
 * TTS pointers (the authoritative source since the pointer migration), not the
 * stale `is_default`/`is_free_default` columns (pending-DROP). Extracted so the
 * derivation + ordering are unit-testable and the service stays under the
 * max-lines limit. Simpler than the LLM variant — TTS has no kind/slot
 * dimension, so each pointer is a single id, not a membership set.
 */

/** The two nullable TTS default-pointer columns on the AdminSettings row. */
export interface TtsDefaultPointerRow {
  globalDefaultTtsConfigId?: string | null;
  freeDefaultTtsConfigId?: string | null;
}

export interface TtsDefaultPointers {
  globalDefaultId: string | null;
  freeDefaultId: string | null;
}

/** Normalize the (possibly missing) AdminSettings row to plain pointer ids. */
export function deriveTtsDefaultPointers(settings: TtsDefaultPointerRow | null): {
  globalDefaultId: string | null;
  freeDefaultId: string | null;
} {
  return {
    globalDefaultId: settings?.globalDefaultTtsConfigId ?? null,
    freeDefaultId: settings?.freeDefaultTtsConfigId ?? null,
  };
}

/**
 * Decorate a DB row (which no longer selects the flag columns) with
 * pointer-derived isDefault/isFreeDefault, preserving the outward API shape.
 */
export function decorateTtsConfigWithDefaultFlags<T extends { id: string }>(
  row: T,
  pointers: TtsDefaultPointers
): T & { isDefault: boolean; isFreeDefault: boolean } {
  return {
    ...row,
    isDefault: row.id === pointers.globalDefaultId,
    isFreeDefault: row.id === pointers.freeDefaultId,
  };
}

/** The subset of a decorated summary the list ordering depends on. */
interface OrderableTtsConfig {
  isDefault: boolean;
  isFreeDefault: boolean;
  isGlobal: boolean;
  name: string;
}

/**
 * List ordering: global default first, then free default, then shared/global
 * configs, then by name. Operates on the pointer-DERIVED flags.
 */
export function compareTtsConfigsForList(a: OrderableTtsConfig, b: OrderableTtsConfig): number {
  if (a.isDefault !== b.isDefault) {
    return a.isDefault ? -1 : 1;
  }
  if (a.isFreeDefault !== b.isFreeDefault) {
    return a.isFreeDefault ? -1 : 1;
  }
  if (a.isGlobal !== b.isGlobal) {
    return a.isGlobal ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}
