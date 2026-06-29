/**
 * Pure list-shaping helpers for `LlmConfigService.list`.
 *
 * Extracted from the service so the ordering + default-pointer derivation can be
 * unit-tested in isolation (and to keep the service under the max-lines limit).
 * Both operate on the AdminSettings default pointers — the authoritative source
 * for "is this config a default" since S3 moved defaults off the boolean columns.
 */

/** The shape of the four nullable default-pointer columns on the AdminSettings row. */
interface DefaultPointerRow {
  globalDefaultLlmConfigId?: string | null;
  globalDefaultVisionConfigId?: string | null;
  freeDefaultLlmConfigId?: string | null;
  freeDefaultVisionConfigId?: string | null;
}

/**
 * Reduce the four global/free default pointers to membership sets. "any-default"
 * semantics: a config is a global default if it's the chat OR vision global
 * pointer; a free default if it's the chat OR vision free pointer.
 */
export function derivePointerSets(settings: DefaultPointerRow | null): {
  globalDefaultIds: Set<string>;
  freeDefaultIds: Set<string>;
} {
  const toSet = (...ids: (string | null | undefined)[]): Set<string> =>
    new Set(ids.filter((id): id is string => id !== null && id !== undefined));
  return {
    globalDefaultIds: toSet(
      settings?.globalDefaultLlmConfigId,
      settings?.globalDefaultVisionConfigId
    ),
    freeDefaultIds: toSet(settings?.freeDefaultLlmConfigId, settings?.freeDefaultVisionConfigId),
  };
}

/** The subset of a config summary the list ordering depends on. */
interface OrderableConfig {
  isDefault: boolean;
  isFreeDefault: boolean;
  isGlobal: boolean;
  name: string;
}

/**
 * List ordering: defaults first (global default, then free default), then
 * shared/global configs, then by name. Operates on the pointer-DERIVED
 * isDefault/isFreeDefault flags, not the stale DB columns.
 */
export function compareConfigsForList(a: OrderableConfig, b: OrderableConfig): number {
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
