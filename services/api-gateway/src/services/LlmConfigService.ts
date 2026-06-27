/**
 * LlmConfigService
 *
 * Unified service layer for LLM configuration CRUD operations.
 * Provides scope-based access control for both admin and user endpoints.
 *
 * Architecture:
 * - Admin routes use GLOBAL scope (isGlobal: true, system-wide configs)
 * - User routes use USER scope (personal configs + view global)
 * - Single source of truth for validation, defaults, and database operations
 *
 * This eliminates duplication between /admin/llm-config and /user/llm-config routes.
 */

import {
  type PrismaClient,
  type LlmConfigCreateInput,
  type LlmConfigUpdateInput,
  LLM_CONFIG_LIST_SELECT,
  LLM_CONFIG_DETAIL_SELECT,
  LLM_CONFIG_DEFAULTS,
  newLlmConfigId,
  generateClonedName,
  stripCopySuffix,
  createLogger,
  safeValidateAdvancedParams,
} from '@tzurot/common-types';
import { type LlmConfigCacheInvalidationService } from '@tzurot/cache-invalidation';

import { isPrismaUniqueConstraintErrorOn } from '../utils/prismaErrors.js';
import { CloneNameExhaustedError, AutoSuffixCollisionError } from './LlmConfigErrors.js';

// Re-exported so route/test importers keep a stable `from './LlmConfigService.js'`
// path (mirrors TtsConfigService's re-export of its error classes).
export { CloneNameExhaustedError, AutoSuffixCollisionError };

const logger = createLogger('LlmConfigService');

// ============================================================================
// Types
// ============================================================================

/**
 * Scope for LLM config operations.
 * Determines access control and default values.
 */
export type LlmConfigScope =
  | { type: 'GLOBAL' }
  | { type: 'USER'; userId: string; discordId: string };

/**
 * Result of checking if a config exists with a given name.
 */
interface NameCheckResult {
  exists: boolean;
  conflictId?: string;
}

/**
 * Raw config from Prisma query (list select).
 */
interface RawConfigList {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  isGlobal: boolean;
  isDefault: boolean;
  isFreeDefault: boolean;
  ownerId: string;
}

/**
 * Raw config from Prisma query (detail select).
 */
interface RawConfigDetail extends RawConfigList {
  advancedParameters: unknown;
  memoryScoreThreshold: { toNumber: () => number };
  memoryLimit: number;
  contextWindowTokens: number;
  maxMessages: number;
  maxAge: number | null;
  maxImages: number;
}

/**
 * Formatted config for the LIST (summary) response — public fields only,
 * no internal `ownerId`.
 */
interface FormattedConfigSummary {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  isGlobal: boolean;
  isDefault: boolean;
  isFreeDefault: boolean;
}

/**
 * Formatted config for API responses.
 */
interface FormattedConfigDetail {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  isGlobal: boolean;
  isDefault: boolean;
  isFreeDefault: boolean;
  memoryScoreThreshold: number;
  memoryLimit: number;
  contextWindowTokens: number;
  maxMessages: number;
  maxAge: number | null;
  maxImages: number;
  params: Record<string, unknown>;
  /** Model's full context window (from OpenRouter), set by enrichWithModelContext */
  modelContextLength?: number;
  /** Model-derived cap for contextWindowTokens (computeContextCap), set by enrichWithModelContext */
  contextWindowCap?: number;
}

// ============================================================================
// Service Class
// ============================================================================

/**
 * Service for managing LLM configurations.
 *
 * Provides unified CRUD operations with scope-based access control.
 * Handles cache invalidation automatically.
 */
export class LlmConfigService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cacheInvalidation?: LlmConfigCacheInvalidationService
  ) {}

  // --------------------------------------------------------------------------
  // Read Operations
  // --------------------------------------------------------------------------

  /**
   * Get a single config by ID.
   * Returns null if not found.
   */
  async getById(configId: string): Promise<RawConfigDetail | null> {
    return this.prisma.llmConfig.findUnique({
      where: { id: configId },
      select: LLM_CONFIG_DETAIL_SELECT,
    });
  }

  /**
   * List configs based on scope.
   *
   * - GLOBAL scope: All configs (for admin view)
   * - USER scope: Global configs + user's own configs
   */
  async list(scope: LlmConfigScope): Promise<RawConfigList[]> {
    // All queries here are scoped to kind='text': this is the TEXT-preset CRUD
    // surface. Vision configs share the llm_configs table (kind='vision') but are
    // seeded/DB-only in Phase 1 — they must not appear in the preset list/autocomplete.
    if (scope.type === 'GLOBAL') {
      // Admin: List all text configs
      return this.prisma.llmConfig.findMany({
        where: { kind: 'text' },
        select: LLM_CONFIG_LIST_SELECT,
        orderBy: [
          { isDefault: 'desc' },
          { isFreeDefault: 'desc' },
          { isGlobal: 'desc' },
          { name: 'asc' },
        ],
        take: 100,
      });
    }

    // User scope: Global configs + user's own configs
    const [globalConfigs, userConfigs] = await Promise.all([
      this.prisma.llmConfig.findMany({
        where: { isGlobal: true, kind: 'text' },
        select: LLM_CONFIG_LIST_SELECT,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        take: 100,
      }),
      this.prisma.llmConfig.findMany({
        where: { ownerId: scope.userId, isGlobal: false, kind: 'text' },
        select: LLM_CONFIG_LIST_SELECT,
        orderBy: { name: 'asc' },
        take: 100,
      }),
    ]);

    return [...globalConfigs, ...userConfigs];
  }

  // --------------------------------------------------------------------------
  // Write Operations
  // --------------------------------------------------------------------------

  /**
   * Create a new LLM config.
   *
   * When `data.autoSuffixOnCollision === true` and the requested name already
   * exists for the same owner, the server bumps a `(Copy N)` suffix until it
   * finds a free slot (via {@link resolveNonCollidingName}). Used by the
   * preset clone flow so the client can issue a single request regardless of
   * how many existing copies the user already has.
   *
   * @param scope - GLOBAL for admin, USER for regular users
   * @param data - Validated input data
   * @param ownerId - Internal user ID for ownership
   * @returns Created config with detail fields
   */
  async create(
    scope: LlmConfigScope,
    data: LlmConfigCreateInput,
    ownerId: string
  ): Promise<RawConfigDetail> {
    const isGlobal = scope.type === 'GLOBAL';
    const requestedName = data.name.trim();

    const effectiveName =
      data.autoSuffixOnCollision === true
        ? await this.resolveNonCollidingName(requestedName, ownerId)
        : requestedName;

    let config;
    try {
      config = await this.prisma.llmConfig.create({
        data: {
          id: newLlmConfigId(),
          name: effectiveName,
          description: data.description ?? null,
          ownerId,
          isGlobal,
          isDefault: false,
          provider: data.provider ?? LLM_CONFIG_DEFAULTS.provider,
          model: data.model.trim(),
          // kind defaults to 'text' (DB default) — this CRUD surface manages text
          // presets only; vision configs are seeded/DB-only in Phase 1.
          advancedParameters: data.advancedParameters ?? undefined,
          // Memory settings — memoryScoreThreshold and memoryLimit are
          // NOT NULL with `@default(0.5)` / `@default(20)` in the schema.
          // Pass the input value directly; when the caller omits, the field
          // is `undefined` and Prisma fills from the schema default. The Zod
          // schema dropped `.nullable()`, so null can't reach this line.
          memoryScoreThreshold: data.memoryScoreThreshold,
          memoryLimit: data.memoryLimit,
          contextWindowTokens: data.contextWindowTokens ?? LLM_CONFIG_DEFAULTS.contextWindowTokens,
          // Context settings
          maxMessages: data.maxMessages ?? LLM_CONFIG_DEFAULTS.maxMessages,
          maxAge: data.maxAge ?? null,
          maxImages: data.maxImages ?? LLM_CONFIG_DEFAULTS.maxImages,
        },
        select: LLM_CONFIG_DETAIL_SELECT,
      });
    } catch (err) {
      // Auto-suffix path: the server-side SELECT said `effectiveName` was free,
      // but a concurrent request just claimed it. Wrap the P2002 so the route
      // can surface the actual collided name (not `body.name` from the client).
      //
      // Scoped to the `(owner_id, name)` target so a hypothetical PK collision
      // (astronomically unlikely under UUIDv7) isn't mislabeled as a name
      // conflict.
      if (
        data.autoSuffixOnCollision === true &&
        isPrismaUniqueConstraintErrorOn(err, ['owner_id', 'name'])
      ) {
        throw new AutoSuffixCollisionError(effectiveName, err);
      }
      throw err;
    }

    logger.info(
      {
        configId: config.id,
        name: config.name,
        scope: scope.type,
        autoSuffixApplied: effectiveName !== requestedName,
      },
      'Created LLM config'
    );

    // Invalidate list caches
    await this.invalidateCacheSafely('create', config.id);

    return config;
  }

  /** Upper bound on how far `resolveNonCollidingName` will iterate before
   *  giving up. Chosen generously — a user with 20+ copies of the same base
   *  name is pathological; we'd rather throw a clear error than loop forever. */
  private static readonly MAX_CLONE_NAME_ATTEMPTS = 20;

  /**
   * Find a name that doesn't collide with any existing config owned by the
   * same user, starting from `baseName` and bumping `(Copy N)` suffixes via
   * `generateClonedName` until a free slot is found.
   *
   * Uses a single SELECT to enumerate all variants (base, `base (Copy)`,
   * `base (Copy N)`) and resolves the bump in-memory, so the server handles
   * the entire collision walk in one DB round-trip instead of the previous
   * client-side loop that fired up to 10 HTTP requests.
   *
   * A race where another request inserts a colliding name between the SELECT
   * and the INSERT is caught by the caller's P2002 translator — not this
   * function's concern.
   */
  private async resolveNonCollidingName(baseName: string, ownerId: string): Promise<string> {
    const stripped = stripCopySuffix(baseName);

    // Tight filter: fetch the exact base name OR a `base (Copy...)` variant.
    // Splitting the copy-variant match into two startsWith predicates —
    // `"<base> (Copy)"` (the no-number form) and `"<base> (Copy "` (the
    // numbered form, note trailing space) — avoids over-fetching false
    // positives like `"<base> (Copycat Theme)"` that can never match a
    // generated candidate but still consume the `take` budget. `orderBy: name
    // asc` puts the base name first and the copy variants right behind it.
    //
    // Bounded read: the in-memory loop walks at most MAX_CLONE_NAME_ATTEMPTS
    // candidates, so the SELECT only needs to see those N rows. Any collision
    // that slips past this limit is still caught by the P2002 translator in
    // `create()`.
    //
    // `name` is a CITEXT column, so exact equality (`{ name: stripped }`) is
    // case-insensitive at the DB level. startsWith compiles to `LIKE` though,
    // and Postgres citext inherits text behavior for LIKE — it does NOT
    // override it to be case-insensitive. `mode: 'insensitive'` switches
    // startsWith to `ILIKE` so lowercase legacy rows like `"preset (copy 5)"`
    // still match a title-case-seeded SELECT. Without this, the walk would
    // miss those rows, pick a "free" candidate, and trip P2002 on INSERT.
    //
    // takenNames is additionally lowercased so the in-memory `Set.has(...)`
    // probe matches how the citext unique index evaluates equality — without
    // the lowercasing, `Set.has("Preset (Copy 2)")` misses `"preset (copy 2)"`
    // fetched via the ILIKE above, same P2002 failure mode via a different
    // path.
    const existing = await this.prisma.llmConfig.findMany({
      where: {
        ownerId,
        kind: 'text',
        OR: [
          { name: stripped },
          { name: { startsWith: `${stripped} (Copy)`, mode: 'insensitive' } },
          { name: { startsWith: `${stripped} (Copy `, mode: 'insensitive' } },
        ],
      },
      select: { name: true },
      orderBy: { name: 'asc' },
      take: LlmConfigService.MAX_CLONE_NAME_ATTEMPTS + 1,
    });
    const takenNames = new Set(existing.map(row => row.name.toLowerCase()));

    let candidate = baseName;
    for (let i = 0; i < LlmConfigService.MAX_CLONE_NAME_ATTEMPTS; i++) {
      if (!takenNames.has(candidate.toLowerCase())) {
        return candidate;
      }
      candidate = generateClonedName(candidate);
    }

    // Pathological: user has 20+ copy variants in a row. Typed so the route
    // can translate to a user-friendly NAME_COLLISION instead of an opaque 500.
    // Passing `stripped` rather than the raw `baseName` means the user-facing
    // message reads "Too many copies of 'Preset'..." instead of "...of
    // 'Preset (Copy 5)'..." — the former is how the user identifies the preset.
    throw new CloneNameExhaustedError(stripped, LlmConfigService.MAX_CLONE_NAME_ATTEMPTS);
  }

  /**
   * Update an existing LLM config.
   *
   * @param configId - ID of config to update
   * @param data - Partial update data
   * @returns Updated config with detail fields
   */
  async update(configId: string, data: Partial<LlmConfigUpdateInput>): Promise<RawConfigDetail> {
    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) {
      updateData.name = data.name.trim();
    }
    if (data.description !== undefined) {
      updateData.description = data.description;
    }
    if (data.provider !== undefined) {
      updateData.provider = data.provider;
    }
    if (data.model !== undefined) {
      updateData.model = data.model.trim();
    }
    if (data.advancedParameters !== undefined) {
      updateData.advancedParameters = data.advancedParameters;
    }
    if (data.memoryScoreThreshold !== undefined) {
      updateData.memoryScoreThreshold = data.memoryScoreThreshold;
    }
    if (data.memoryLimit !== undefined) {
      updateData.memoryLimit = data.memoryLimit;
    }
    if (data.contextWindowTokens !== undefined) {
      updateData.contextWindowTokens = data.contextWindowTokens;
    }
    if (data.maxMessages !== undefined) {
      updateData.maxMessages = data.maxMessages;
    }
    if (data.maxAge !== undefined) {
      updateData.maxAge = data.maxAge;
    }
    if (data.maxImages !== undefined) {
      updateData.maxImages = data.maxImages;
    }
    if (data.isGlobal !== undefined) {
      updateData.isGlobal = data.isGlobal;
    }

    const config = await this.prisma.llmConfig.update({
      where: { id: configId },
      data: updateData,
      select: LLM_CONFIG_DETAIL_SELECT,
    });

    logger.info({ configId, updates: Object.keys(updateData) }, 'Updated LLM config');

    await this.invalidateCacheSafely('update', configId);

    return config;
  }

  /**
   * Delete an LLM config.
   *
   * @param configId - ID of config to delete
   */
  async delete(configId: string): Promise<void> {
    await this.prisma.llmConfig.delete({ where: { id: configId } });

    logger.info({ configId }, 'Deleted LLM config');

    await this.invalidateCacheSafely('delete', configId);
  }

  // --------------------------------------------------------------------------
  // Admin-only Operations
  // --------------------------------------------------------------------------

  /**
   * Set a config as the system default.
   * Clears any existing default first.
   *
   * @param configId - ID of config to set as default
   */
  async setAsDefault(configId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      // Resolve the target's kind so we clear the existing default WITHIN that kind
      // only. text and vision each carry their own isDefault (per-kind partial unique
      // index `llm_configs_default_unique`), so an unscoped clear would wipe the other
      // kind's default — e.g. setting a text default would silently un-set the vision
      // global default and collapse vision resolution to the hardcoded fallback.
      const target = await tx.llmConfig.findUnique({
        where: { id: configId },
        select: { kind: true },
      });
      const kind = target?.kind ?? 'text';
      // Clear existing default for this kind
      await tx.llmConfig.updateMany({
        where: { isDefault: true, kind },
        data: { isDefault: false },
      });
      // Set new default
      await tx.llmConfig.update({
        where: { id: configId },
        data: { isDefault: true },
      });
    });

    logger.info({ configId }, 'Set LLM config as system default');

    await this.invalidateCacheSafely('set-default', configId);
  }

  /**
   * Set a config as the free tier default.
   * Clears any existing free default first.
   *
   * @param configId - ID of config to set as free default
   */
  async setAsFreeDefault(configId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      // Per-kind clear — see setAsDefault: isFreeDefault is unique per kind
      // (`llm_configs_free_default_unique`), so the clear must not cross kinds.
      const target = await tx.llmConfig.findUnique({
        where: { id: configId },
        select: { kind: true },
      });
      const kind = target?.kind ?? 'text';
      // Clear existing free default for this kind
      await tx.llmConfig.updateMany({
        where: { isFreeDefault: true, kind },
        data: { isFreeDefault: false },
      });
      // Set new free default
      await tx.llmConfig.update({
        where: { id: configId },
        data: { isFreeDefault: true },
      });
    });

    logger.info({ configId }, 'Set LLM config as free tier default');

    await this.invalidateCacheSafely('set-free-default', configId);
  }

  // --------------------------------------------------------------------------
  // Validation Helpers
  // --------------------------------------------------------------------------

  /**
   * Check if a name is already in use.
   *
   * For USER scope, checks the caller's own configs by default. When the
   * post-update state will be `isGlobal: true`, ALSO checks the global
   * namespace — catches the cross-user collision case where a non-bot-owner
   * promotes their config and the suffixed name collides with another user's
   * existing global. Without this second check, the partial-unique constraint
   * `*_configs_global_name_unique` would fire inside `update()` as a
   * Prisma P2002, surfacing to Express's default 500 handler.
   *
   * @param name - Name to check
   * @param scope - Scope to check within (GLOBAL or USER)
   * @param excludeId - Optional ID to exclude (for update operations)
   * @param postIsGlobal - Whether the post-update state will be global. Only
   *   meaningful for USER scope; defaults false (admin/normal updates skip
   *   the global-namespace check). Pass `true` from the user route's PUT
   *   handler when the patch results in `isGlobal: true`.
   * @returns Whether name exists and the conflicting ID if any
   */
  async checkNameExists(
    name: string,
    scope: LlmConfigScope,
    excludeId?: string,
    postIsGlobal = false
  ): Promise<NameCheckResult> {
    const trimmedName = name.trim();
    const excludeClause = excludeId !== undefined ? { id: { not: excludeId } } : {};

    if (scope.type === 'GLOBAL') {
      // Admin: Check among global configs only
      const existing = await this.prisma.llmConfig.findFirst({
        where: { name: trimmedName, isGlobal: true, kind: 'text', ...excludeClause },
        select: { id: true },
      });
      return existing === null ? { exists: false } : { exists: true, conflictId: existing.id };
    }

    // USER scope: own-namespace check is always required. Global-namespace check
    // additionally fires when the post-update state will be global.
    const ownClause: Record<string, unknown> = {
      name: trimmedName,
      ownerId: scope.userId,
      // Text-preset namespace only (kind='vision' configs are seeded globals, not
      // user-owned) — keeps the app check aligned with the per-kind unique index.
      kind: 'text',
      ...excludeClause,
    };
    const ownPromise = this.prisma.llmConfig.findFirst({
      where: ownClause,
      select: { id: true },
    });

    if (!postIsGlobal) {
      const existing = await ownPromise;
      return existing === null ? { exists: false } : { exists: true, conflictId: existing.id };
    }

    const globalPromise = this.prisma.llmConfig.findFirst({
      // kind='text' mirrors the partial-unique index this check pre-empts
      // (`llm_configs_global_name_unique` is UNIQUE (kind, name) WHERE is_global);
      // without it a text promotion would falsely collide with a same-named vision global.
      where: { name: trimmedName, isGlobal: true, kind: 'text', ...excludeClause },
      select: { id: true },
    });
    const [own, global] = await Promise.all([ownPromise, globalPromise]);
    const existing = own ?? global;

    return {
      exists: existing !== null,
      conflictId: existing?.id,
    };
  }

  /** Returns { blocker, warning }: blocker stops deletion; warning advises N users will have personal default SET NULL. Mirror of TtsConfigService.checkDeleteConstraints. */
  async checkDeleteConstraints(
    configId: string
  ): Promise<{ blocker: string | null; warning: string | null }> {
    // users.default_llm_config_id is ON DELETE SET NULL — delete works regardless,
    // but surfacing the count lets the admin confirm before silent-nulling N users.
    const [personalityCount, userOverrideCount, usersWithAsPersonalDefault] = await Promise.all([
      this.prisma.personalityDefaultConfig.count({
        where: { llmConfigId: configId },
      }),
      this.prisma.userPersonalityConfig.count({
        where: { llmConfigId: configId },
      }),
      this.prisma.user.count({
        where: { defaultLlmConfigId: configId },
      }),
    ]);

    let blocker: string | null = null;
    if (personalityCount > 0) {
      blocker = `Cannot delete: config is used as default by ${personalityCount} personality(ies)`;
    } else if (userOverrideCount > 0) {
      blocker = `Cannot delete: config is used by ${userOverrideCount} user override(s)`;
    }

    const warning =
      usersWithAsPersonalDefault > 0
        ? `Deleting this LLM config will reset ${usersWithAsPersonalDefault} user(s)' personal default to NULL`
        : null;

    return { blocker, warning };
  }

  // --------------------------------------------------------------------------
  // Response Formatting
  // --------------------------------------------------------------------------

  /**
   * Format a raw config for API response.
   * Parses advancedParameters and converts Decimal to number.
   */
  formatConfigDetail(raw: RawConfigDetail): FormattedConfigDetail {
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      provider: raw.provider,
      model: raw.model,
      isGlobal: raw.isGlobal,
      isDefault: raw.isDefault,
      isFreeDefault: raw.isFreeDefault,
      memoryScoreThreshold: raw.memoryScoreThreshold.toNumber(),
      memoryLimit: raw.memoryLimit,
      contextWindowTokens: raw.contextWindowTokens,
      maxMessages: raw.maxMessages,
      maxAge: raw.maxAge,
      maxImages: raw.maxImages,
      params: safeValidateAdvancedParams(raw.advancedParameters) ?? {},
    };
  }

  /**
   * Format a raw list row for the summary (list) response.
   *
   * Projects only the public list fields and — crucially — EXCLUDES the
   * internal `ownerId` column that `LLM_CONFIG_LIST_SELECT` carries. Callers
   * use `raw.ownerId` to compute `isOwned`/`permissions` before formatting,
   * but `ownerId` must not travel into the HTTP response body (it's an internal
   * UUID, and the user-facing list would otherwise expose other users' owner
   * IDs). Mirrors `formatConfigDetail`'s explicit-projection discipline.
   */
  formatConfigSummary(raw: RawConfigList): FormattedConfigSummary {
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      provider: raw.provider,
      model: raw.model,
      isGlobal: raw.isGlobal,
      isDefault: raw.isDefault,
      isFreeDefault: raw.isFreeDefault,
    };
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /**
   * Safely invalidate caches, logging but not throwing on failure.
   */
  private async invalidateCacheSafely(operation: string, configId: string): Promise<void> {
    if (!this.cacheInvalidation) {
      return;
    }

    try {
      await this.cacheInvalidation.invalidateAll();
      logger.debug({ configId, operation }, 'Invalidated LLM config caches');
    } catch (err) {
      logger.error({ err, configId, operation }, 'Failed to invalidate LLM config caches');
    }
  }
}
