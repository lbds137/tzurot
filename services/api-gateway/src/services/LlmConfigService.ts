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

import { type ModelSlot } from '@tzurot/common-types/constants/ai';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  type LlmConfigCreateInput,
  type LlmConfigUpdateInput,
  LLM_CONFIG_LIST_SELECT,
  LLM_CONFIG_DETAIL_SELECT,
  LLM_CONFIG_DEFAULTS,
} from '@tzurot/common-types/schemas/api/llm-config';
import { safeValidateAdvancedParams } from '@tzurot/common-types/schemas/llmAdvancedParams';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { newLlmConfigId } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type LlmConfigCacheInvalidationService } from '@tzurot/cache-invalidation';

import { isPrismaUniqueConstraintErrorOn } from '../utils/prismaErrors.js';
import { CloneNameExhaustedError, AutoSuffixCollisionError } from './LlmConfigErrors.js';
import { resolveNonCollidingName } from './llmConfigNameCollision.js';
import { warnOnReasoningConstraintViolation } from './reasoningConstraintCheck.js';
import { compareConfigsForList, derivePointerSets } from './llmConfigListHelpers.js';

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
  { type: 'GLOBAL' } | { type: 'USER'; userId: string; discordId: string };

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
  ownerId: string;
}

/**
 * A list config with its default flags DERIVED from the AdminSettings pointers
 * (S3) by {@link LlmConfigService.list}'s `applyDefaultFlags` — NOT read from the
 * (dropped in the legacy-column retirement) `isDefault`/`isFreeDefault`
 * columns. This is the shape
 * `list()` returns and `formatConfigSummary` consumes.
 */
interface RawConfigListWithFlags extends RawConfigList {
  isDefault: boolean;
  isFreeDefault: boolean;
}

/**
 * Raw config from Prisma query (detail select).
 */
interface RawConfigDetail extends RawConfigList {
  advancedParameters: unknown;
  contextWindowTokens: number;
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
  contextWindowTokens: number;
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
   * Get a single config by ID. Returns null if not found.
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
  async list(scope: LlmConfigScope): Promise<RawConfigListWithFlags[]> {
    // Bound note: each findMany is `take: 100`. For USER scope that's two
    // parallel queries (global + owned), so the merged result can reach 200.
    // browse paginates, so a larger set is fine.
    //
    // isDefault/isFreeDefault moved to the AdminSettings pointers in S3; the
    // boolean columns are no longer maintained (set-default writes only the
    // pointer), so they're stale. Derive both flags — and the defaults-first
    // ordering — from the live pointers here. (isGlobal stays a real column.)
    const { globalDefaultIds, freeDefaultIds } = await this.getDefaultPointerSets();
    const applyDefaultFlags = (raw: RawConfigList): RawConfigListWithFlags => ({
      ...raw,
      isDefault: globalDefaultIds.has(raw.id),
      isFreeDefault: freeDefaultIds.has(raw.id),
    });

    if (scope.type === 'GLOBAL') {
      // Admin: list all configs. Base-order by name in the DB; the
      // defaults-first sort is applied in-app from the derived flags (the DB
      // orderBy can't express pointer membership).
      const configs = await this.prisma.llmConfig.findMany({
        select: LLM_CONFIG_LIST_SELECT,
        orderBy: { name: 'asc' },
        take: 100,
      });
      return configs.map(applyDefaultFlags).sort(compareConfigsForList);
    }

    // User scope: Global configs + user's own configs
    const [globalConfigs, userConfigs] = await Promise.all([
      this.prisma.llmConfig.findMany({
        where: { isGlobal: true },
        select: LLM_CONFIG_LIST_SELECT,
        orderBy: { name: 'asc' },
        take: 100,
      }),
      this.prisma.llmConfig.findMany({
        where: { ownerId: scope.userId, isGlobal: false },
        select: LLM_CONFIG_LIST_SELECT,
        orderBy: { name: 'asc' },
        take: 100,
      }),
    ]);

    // Globals first (defaults-first within them), then the user's own configs
    // by name — a user's own config is never a global/free-default pointer
    // target, so it carries no default flag.
    return [
      ...globalConfigs.map(applyDefaultFlags).sort(compareConfigsForList),
      ...userConfigs.map(applyDefaultFlags),
    ];
  }

  /**
   * Read the four global/free default pointers off the AdminSettings singleton
   * as membership sets. Defaults moved to these pointers in S3; the boolean
   * isDefault/isFreeDefault columns are no longer maintained, so list-summary
   * flags + ordering derive from these.
   */
  private async getDefaultPointerSets(): Promise<{
    globalDefaultIds: Set<string>;
    freeDefaultIds: Set<string>;
  }> {
    // Read the AdminSettings singleton by its fixed id — same filter the
    // delete-guard and VisionConfigResolver use. There's only ever one row, but
    // the explicit id keeps this correct (right default flags + ordering) if a
    // stray row ever appeared.
    const settings = await this.prisma.adminSettings.findUnique({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      select: {
        globalDefaultLlmConfigId: true,
        globalDefaultVisionConfigId: true,
        freeDefaultLlmConfigId: true,
        freeDefaultVisionConfigId: true,
      },
    });
    return derivePointerSets(settings);
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
        ? await resolveNonCollidingName(this.prisma, requestedName, ownerId)
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
          // isDefault/isFreeDefault no longer exist on this model; default-ness
          // lives entirely on the AdminSettings pointers (S3).
          provider: data.provider ?? LLM_CONFIG_DEFAULTS.provider,
          model: data.model.trim(),
          advancedParameters: data.advancedParameters ?? undefined,
          // Memory + context-limit columns (memoryScoreThreshold/memoryLimit,
          // maxMessages/maxAge/maxImages) are retired — they come from the config
          // cascade now; the columns keep their DB defaults until they're dropped.
          contextWindowTokens: data.contextWindowTokens ?? LLM_CONFIG_DEFAULTS.contextWindowTokens,
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

    warnOnReasoningConstraintViolation(logger, { configId: config.id }, data.advancedParameters);

    // Invalidate list caches
    await this.invalidateCacheSafely('create', config.id);

    return config;
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
    if (data.contextWindowTokens !== undefined) {
      updateData.contextWindowTokens = data.contextWindowTokens;
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

    warnOnReasoningConstraintViolation(logger, { configId }, data.advancedParameters);

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
   * Set a config as the global (paid) default for a slot.
   *
   * Writes the per-slot pointer on the AdminSettings singleton — the slot (chat
   * vs vision) is always the caller's choice. A config can be
   * the chat default and the vision default simultaneously (separate pointers).
   * The config's existence and (for the vision slot) capability are validated at
   * the route layer before this is called — an invalid id reaching the upsert
   * surfaces as a Prisma FK-constraint error, not a clean 404.
   *
   * Read-asymmetry note: of the four default pointers, the resolver cascade only
   * consults `globalDefaultVisionConfigId` (VisionConfigResolver) and
   * `freeDefaultLlmConfigId` (LlmConfigResolver). The chat-global and vision-free
   * pointers are settable for slot symmetry but have no resolution tier reading
   * them yet — wiring those is tracked in `backlog/cold/follow-ups.md`. (This
   * matches the pre-cutover flags: the LLM cascade never had a paid-chat-global
   * tier, and the vision-free read was already deferred.)
   *
   * @param configId - ID of config to point the slot at
   * @param slot - which default slot to set ('text' = chat, or 'vision')
   */
  async setAsDefault(configId: string, slot: ModelSlot): Promise<void> {
    const data =
      slot === 'vision'
        ? { globalDefaultVisionConfigId: configId }
        : { globalDefaultLlmConfigId: configId };
    await this.prisma.adminSettings.upsert({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      create: { id: ADMIN_SETTINGS_SINGLETON_ID, ...data },
      update: data,
    });

    logger.info({ configId, slot }, 'Set LLM config as global default');

    await this.invalidateCacheSafely('set-default', configId);
  }

  /**
   * Set a config as the free-tier default for a slot (guest / no-BYOK fallback).
   *
   * Writes the per-slot free-default pointer on the AdminSettings singleton. The
   * `:free` model check and (for the vision slot) the capability gate are enforced
   * at the route layer before this is called.
   *
   * @param configId - ID of config to point the slot at
   * @param slot - which free-default slot to set ('text' = chat, or 'vision')
   */
  async setAsFreeDefault(configId: string, slot: ModelSlot): Promise<void> {
    const data =
      slot === 'vision'
        ? { freeDefaultVisionConfigId: configId }
        : { freeDefaultLlmConfigId: configId };
    await this.prisma.adminSettings.upsert({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      create: { id: ADMIN_SETTINGS_SINGLETON_ID, ...data },
      update: data,
    });

    logger.info({ configId, slot }, 'Set LLM config as free tier default');

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
      // Admin: check the single global namespace (names are unique per
      // owner and — via the partial-unique index — across all globals).
      const existing = await this.prisma.llmConfig.findFirst({
        where: { name: trimmedName, isGlobal: true, ...excludeClause },
        select: { id: true },
      });
      return existing === null ? { exists: false } : { exists: true, conflictId: existing.id };
    }

    // USER scope: own-namespace check is always required. Global-namespace check
    // additionally fires when the post-update state will be global.
    const ownClause: Record<string, unknown> = {
      name: trimmedName,
      ownerId: scope.userId,
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
      // Mirrors the partial-unique index this check pre-empts
      // (`llm_configs_global_name_unique` is UNIQUE (name) WHERE is_global).
      where: { name: trimmedName, isGlobal: true, ...excludeClause },
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
      // isDefault/isFreeDefault are NOT on the detail response: defaults live on
      // the AdminSettings pointers (S3), and no client reads them off the detail
      // — the ⭐/🆓 badges derive from the pointer-based flags on the LIST summary.
      contextWindowTokens: raw.contextWindowTokens,
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
  formatConfigSummary(raw: RawConfigListWithFlags): FormattedConfigSummary {
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
