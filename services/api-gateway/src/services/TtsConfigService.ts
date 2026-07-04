/**
 * TtsConfigService
 *
 * Unified service layer for TTS configuration CRUD operations. Mirrors
 * `LlmConfigService` shape (scope-based access control, auto-suffix clone
 * collision handling, transactional admin defaults) with TTS-specific
 * adaptations:
 *
 * - Smaller field surface (no memory/context/sampling settings — TTS only
 *   has `provider`, `modelId`, `advancedParameters`)
 * - System-globals bootstrap on `list(GLOBAL)` first-call (council
 *   refinement, 2026-05-03): if the GLOBAL query returns `[]`, seed the 3
 *   well-known configs and re-query. Lazy, race-safe via
 *   `createMany({ skipDuplicates: true })`. Skipped if no superuser exists
 *   yet (matches the seed migration's gating shape).
 * - `update()` enforces `isTtsProviderId(merged.provider)` before the
 *   Prisma write — `TtsConfigUpdateSchema` intentionally accepts any
 *   string for empty-string-preserve semantics, so the strict-validation
 *   invariant lives at the service layer (filed in inbox.md from PR
 *   #960 round 1).
 *
 * Architecture:
 * - Admin routes use GLOBAL scope (isGlobal: true, system-wide configs)
 * - User routes use USER scope (personal configs + view global)
 * - Single source of truth for validation, defaults, and DB operations
 */

import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  type TtsConfigCreateInput,
  type TtsConfigUpdateInput,
  TTS_CONFIG_LIST_SELECT,
  TTS_CONFIG_DETAIL_SELECT,
  TTS_CONFIG_DEFAULTS,
} from '@tzurot/common-types/schemas/api/tts-config';
import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { isTtsProviderId } from '@tzurot/common-types/services/tts/TtsProvider';
import { newTtsConfigId } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { generateClonedName, stripCopySuffix } from '@tzurot/common-types/utils/presetCloneName';
import { type TtsConfigCacheInvalidationService } from '@tzurot/cache-invalidation';

import { isPrismaUniqueConstraintErrorOn } from '../utils/prismaErrors.js';
import { bootstrapTtsSystemGlobalsIfNeeded } from './TtsConfigBootstrap.js';
import {
  deriveTtsDefaultPointers,
  decorateTtsConfigWithDefaultFlags,
  compareTtsConfigsForList,
  type TtsDefaultPointers,
} from './ttsConfigListHelpers.js';
import {
  TtsCloneNameExhaustedError,
  TtsAutoSuffixCollisionError,
  TtsInvalidProviderError,
} from './TtsConfigErrors.js';
import { NotFoundError } from '../utils/appErrors.js';

const logger = createLogger('TtsConfigService');

// ============================================================================
// Types
// ============================================================================

/**
 * Scope for TTS config operations. Determines access control and which
 * configs are visible.
 */
export type TtsConfigScope =
  { type: 'GLOBAL' } | { type: 'USER'; userId: string; discordId: string };

/**
 * Result of checking if a config exists with a given name.
 */
interface NameCheckResult {
  exists: boolean;
  conflictId?: string;
}

/**
 * Config summary as it leaves the service (list select + pointer-derived
 * default flags). Mirrors LlmConfig's list shape minus the LLM-only fields
 * (no `model`, `visionModel`, memory/context).
 *
 * isDefault/isFreeDefault are DERIVED from the AdminSettings TTS pointers
 * (`decorateTtsConfigWithDefaultFlags`) — the DB columns are stale
 * (pending-DROP) and no longer selected.
 */
interface RawTtsConfigList {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  modelId: string | null;
  isGlobal: boolean;
  isDefault: boolean;
  isFreeDefault: boolean;
  ownerId: string;
}

/** The list select's actual DB shape — before flag decoration. */
type RawTtsConfigListFromDb = Omit<RawTtsConfigList, 'isDefault' | 'isFreeDefault'>;

/**
 * Config detail as it leaves the service (decorated, like the list shape).
 */
interface RawTtsConfigDetail extends RawTtsConfigList {
  advancedParameters: unknown;
}

/**
 * Formatted config for API responses.
 */
interface FormattedTtsConfigDetail {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  modelId: string | null;
  isGlobal: boolean;
  isDefault: boolean;
  isFreeDefault: boolean;
  params: Record<string, unknown>;
}

// Typed errors live in `./TtsConfigErrors.ts` to keep this file under the
// ESLint max-lines limit. Re-export so existing callers (route layer, tests)
// don't need to know about the split.
export { TtsCloneNameExhaustedError, TtsAutoSuffixCollisionError, TtsInvalidProviderError };

// System-globals seed shape and bootstrap logic live in `./TtsConfigBootstrap.ts`.

// ============================================================================
// Service Class
// ============================================================================

export class TtsConfigService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cacheInvalidation?: TtsConfigCacheInvalidationService
  ) {}

  // --------------------------------------------------------------------------
  // Read Operations
  // --------------------------------------------------------------------------

  /** Get a single config by ID (default flags pointer-derived). Returns null if not found. */
  async getById(configId: string): Promise<RawTtsConfigDetail | null> {
    const [config, pointers] = await Promise.all([
      this.prisma.ttsConfig.findUnique({
        where: { id: configId },
        select: TTS_CONFIG_DETAIL_SELECT,
      }),
      this.getDefaultPointers(),
    ]);
    return config === null ? null : decorateTtsConfigWithDefaultFlags(config, pointers);
  }

  /**
   * Fetch the TTS default pointers off the AdminSettings singleton. The stale
   * isDefault/isFreeDefault columns are no longer maintained, so summary flags
   * + list ordering derive from these.
   */
  private async getDefaultPointers(): Promise<TtsDefaultPointers> {
    const settings = await this.prisma.adminSettings.findUnique({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      select: {
        globalDefaultTtsConfigId: true,
        freeDefaultTtsConfigId: true,
      },
    });
    return deriveTtsDefaultPointers(settings);
  }

  /**
   * List configs based on scope.
   *
   * - GLOBAL scope: All configs (admin view)
   * - USER scope: Global configs + user's own configs
   *
   * Bootstrap: when GLOBAL is empty (fresh DB, no superuser at migration
   * time), the service seeds the 3 system globals and re-queries. Race-safe
   * via `createMany({ skipDuplicates: true })` — concurrent first-callers
   * resolve to the same final state.
   */
  async list(scope: TtsConfigScope): Promise<RawTtsConfigList[]> {
    if (scope.type === 'GLOBAL') {
      const configs = await this.queryGlobalConfigs();
      if (configs.length > 0) {
        return this.decorateAndOrder(configs);
      }
      // Empty result → attempt bootstrap, then re-query
      await bootstrapTtsSystemGlobalsIfNeeded(this.prisma);
      return this.decorateAndOrder(await this.queryGlobalConfigs());
    }

    // User scope: bootstrap globals first so a brand-new dev DB sees them too
    const [globalConfigs, userConfigs] = await Promise.all([
      this.queryGlobalConfigs(),
      this.prisma.ttsConfig.findMany({
        where: { ownerId: scope.userId, isGlobal: false },
        select: TTS_CONFIG_LIST_SELECT,
        orderBy: { name: 'asc' },
        take: 100,
      }),
    ]);

    if (globalConfigs.length === 0) {
      await bootstrapTtsSystemGlobalsIfNeeded(this.prisma);
      const seeded = await this.queryGlobalConfigs();
      return this.decorateAndOrder(seeded, userConfigs);
    }

    return this.decorateAndOrder(globalConfigs, userConfigs);
  }

  /**
   * Decorate DB rows with pointer-derived default flags and order the GLOBAL
   * segment defaults-first. The user segment keeps its name-asc order and is
   * appended after the globals (unchanged list contract).
   */
  private async decorateAndOrder(
    globalConfigs: RawTtsConfigListFromDb[],
    userConfigs: RawTtsConfigListFromDb[] = []
  ): Promise<RawTtsConfigList[]> {
    const pointers = await this.getDefaultPointers();
    const decoratedGlobals = globalConfigs
      .map(c => decorateTtsConfigWithDefaultFlags(c, pointers))
      .sort(compareTtsConfigsForList);
    const decoratedUsers = userConfigs.map(c => decorateTtsConfigWithDefaultFlags(c, pointers));
    return [...decoratedGlobals, ...decoratedUsers];
  }

  private async queryGlobalConfigs(): Promise<RawTtsConfigListFromDb[]> {
    // No orderBy on default flags — ordering derives from the AdminSettings
    // pointers post-decoration (see decorateAndOrder).
    return this.prisma.ttsConfig.findMany({
      where: { isGlobal: true },
      select: TTS_CONFIG_LIST_SELECT,
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  // --------------------------------------------------------------------------
  // Write Operations
  // --------------------------------------------------------------------------

  /**
   * Create a new TTS config.
   *
   * When `data.autoSuffixOnCollision === true` and the requested name already
   * exists for the same owner, the server bumps a `(Copy N)` suffix until it
   * finds a free slot. Mirrors the LlmConfig clone flow.
   */
  async create(
    scope: TtsConfigScope,
    data: TtsConfigCreateInput,
    ownerId: string
  ): Promise<RawTtsConfigDetail> {
    const isGlobal = scope.type === 'GLOBAL';
    const requestedName = data.name.trim();

    const effectiveName =
      data.autoSuffixOnCollision === true
        ? await this.resolveNonCollidingName(requestedName, ownerId)
        : requestedName;

    let config;
    try {
      config = await this.prisma.ttsConfig.create({
        data: {
          id: newTtsConfigId(),
          name: effectiveName,
          description: data.description ?? null,
          ownerId,
          isGlobal,
          // isDefault/isFreeDefault omitted — the stale columns keep their
          // schema @default(false); default-ness lives on the AdminSettings pointers.
          provider: data.provider ?? TTS_CONFIG_DEFAULTS.provider,
          modelId: data.modelId ?? null,
          // Schema is permissive (Record<string, unknown>) — each provider
          // validates its own params at synthesize time, so we cast to
          // Prisma.InputJsonValue at the DB boundary.
          advancedParameters:
            data.advancedParameters === undefined
              ? undefined
              : (data.advancedParameters as Prisma.InputJsonValue),
        },
        select: TTS_CONFIG_DETAIL_SELECT,
      });
    } catch (err) {
      // Auto-suffix path race: SELECT said `effectiveName` was free, but a
      // concurrent request just claimed it. Wrap the P2002 so the route can
      // surface the actual collided name (not body.name from the client).
      if (
        data.autoSuffixOnCollision === true &&
        isPrismaUniqueConstraintErrorOn(err, ['owner_id', 'name'])
      ) {
        throw new TtsAutoSuffixCollisionError(effectiveName, err);
      }
      throw err;
    }

    logger.info(
      {
        configId: config.id,
        name: config.name,
        scope: scope.type,
        provider: config.provider,
        autoSuffixApplied: effectiveName !== requestedName,
      },
      'Created TTS config'
    );

    await this.invalidateCacheSafely('create', config.id);
    // A fresh config is never a default, but decorate uniformly so the
    // outward shape always carries the pointer-derived flags.
    return decorateTtsConfigWithDefaultFlags(config, await this.getDefaultPointers());
  }

  /** Upper bound on how far `resolveNonCollidingName` will iterate before
   *  throwing. Same value as LLM (20) — pathological cases pass through. */
  private static readonly MAX_CLONE_NAME_ATTEMPTS = 20;

  /**
   * Find a name that doesn't collide with any existing config owned by the
   * same user, starting from `baseName` and bumping `(Copy N)` suffixes via
   * `generateClonedName` until a free slot is found.
   *
   * Mirrors `LlmConfigService.resolveNonCollidingName` exactly — same
   * single-SELECT in-memory walk, same case-insensitive handling for citext
   * via lowercase Set probes + `mode: 'insensitive'` startsWith.
   */
  private async resolveNonCollidingName(baseName: string, ownerId: string): Promise<string> {
    const stripped = stripCopySuffix(baseName);

    const existing = await this.prisma.ttsConfig.findMany({
      where: {
        ownerId,
        OR: [
          { name: stripped },
          { name: { startsWith: `${stripped} (Copy)`, mode: 'insensitive' } },
          { name: { startsWith: `${stripped} (Copy `, mode: 'insensitive' } },
        ],
      },
      select: { name: true },
      orderBy: { name: 'asc' },
      take: TtsConfigService.MAX_CLONE_NAME_ATTEMPTS + 1,
    });
    const takenNames = new Set(existing.map(row => row.name.toLowerCase()));

    let candidate = baseName;
    for (let i = 0; i < TtsConfigService.MAX_CLONE_NAME_ATTEMPTS; i++) {
      if (!takenNames.has(candidate.toLowerCase())) {
        return candidate;
      }
      candidate = generateClonedName(candidate);
    }

    throw new TtsCloneNameExhaustedError(stripped, TtsConfigService.MAX_CLONE_NAME_ATTEMPTS);
  }

  /**
   * Update an existing TTS config.
   *
   * Service-layer `isTtsProviderId` enforcement: the schema accepts any
   * string for `provider` (empty-string-preserve semantics); this is the
   * layer that rejects garbage values like `'mistal'` (typo) before the
   * Prisma write hits. Throws `TtsInvalidProviderError` on bad input —
   * route translates to `VALIDATION_ERROR`.
   */
  async update(configId: string, data: Partial<TtsConfigUpdateInput>): Promise<RawTtsConfigDetail> {
    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined && data.name.length > 0) {
      // Schema's `optionalString(40)` accepts empty strings (the dashboard
      // form's "I didn't change this field" signal). Treat empty-string as
      // preserve-existing — same shape as the provider guard below.
      updateData.name = data.name.trim();
    }
    if (data.description !== undefined) {
      updateData.description = data.description;
    }
    if (data.provider !== undefined && data.provider.length > 0) {
      // Schema accepts any string up to 40 chars; we enforce the strict
      // TtsProviderId set here so the DB never sees a garbage value.
      // Empty string falls through to "preserve existing" by skipping the
      // assignment entirely (the dashboard sends "" for unchanged fields).
      if (!isTtsProviderId(data.provider)) {
        throw new TtsInvalidProviderError(data.provider);
      }
      updateData.provider = data.provider;
    }
    if (data.modelId !== undefined) {
      updateData.modelId = data.modelId;
    }
    if (data.advancedParameters !== undefined) {
      updateData.advancedParameters = data.advancedParameters;
    }
    if (data.isGlobal !== undefined) {
      updateData.isGlobal = data.isGlobal;
    }

    const config = await this.prisma.ttsConfig.update({
      where: { id: configId },
      data: updateData,
      select: TTS_CONFIG_DETAIL_SELECT,
    });

    logger.info({ configId, updates: Object.keys(updateData) }, 'Updated TTS config');

    await this.invalidateCacheSafely('update', configId);
    return decorateTtsConfigWithDefaultFlags(config, await this.getDefaultPointers());
  }

  /** Delete a TTS config. */
  async delete(configId: string): Promise<void> {
    await this.prisma.ttsConfig.delete({ where: { id: configId } });
    logger.info({ configId }, 'Deleted TTS config');
    await this.invalidateCacheSafely('delete', configId);
  }

  // --------------------------------------------------------------------------
  // Admin-only Operations
  // --------------------------------------------------------------------------

  /**
   * Assert the config exists before repointing an AdminSettings default. Routes guard with a
   * fetch-or-404 helper first, so a null here is a delete-between-reads race —
   * throw NotFoundError (→ 404 via asyncHandler) rather than letting the
   * upsert reference a vanished id and surface as an FK-violation 500 leaking
   * the raw error. (Mirrors LlmConfigService.resolveTargetKindOrThrow, minus the
   * kind — TTS configs have no kind discriminator.)
   */
  private async assertConfigExistsOrThrow(configId: string, op: string): Promise<void> {
    const target = await this.prisma.ttsConfig.findUnique({
      where: { id: configId },
      select: { id: true },
    });
    if (target === null) {
      throw new NotFoundError('TTS config', `${op}: config ${configId} not found`);
    }
  }

  /**
   * Set a config as the system default by repointing the AdminSettings pointer.
   * Replaces the old clear-all-then-set flag flip; the singleton upsert is
   * atomic on its own, so no transaction is needed.
   */
  async setAsDefault(configId: string): Promise<void> {
    await this.assertConfigExistsOrThrow(configId, 'setAsDefault');
    await this.prisma.adminSettings.upsert({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      create: { id: ADMIN_SETTINGS_SINGLETON_ID, globalDefaultTtsConfigId: configId },
      update: { globalDefaultTtsConfigId: configId },
    });
    logger.info({ configId }, 'Set TTS config as system default');
    await this.invalidateCacheSafely('set-default', configId);
  }

  /** Set a config as the free tier default by repointing the AdminSettings pointer. */
  async setAsFreeDefault(configId: string): Promise<void> {
    await this.assertConfigExistsOrThrow(configId, 'setAsFreeDefault');
    await this.prisma.adminSettings.upsert({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
      create: { id: ADMIN_SETTINGS_SINGLETON_ID, freeDefaultTtsConfigId: configId },
      update: { freeDefaultTtsConfigId: configId },
    });
    logger.info({ configId }, 'Set TTS config as free tier default');
    await this.invalidateCacheSafely('set-free-default', configId);
  }

  // --------------------------------------------------------------------------
  // Validation Helpers
  // --------------------------------------------------------------------------

  /**
   * Check if a name is already in use within the given scope.
   *
   * For USER scope, checks the caller's own configs by default. When the
   * post-update state will be `isGlobal: true`, ALSO checks the global
   * namespace — catches the cross-user collision case where a non-bot-owner
   * promotes their config and the suffixed name collides with another user's
   * existing global. Without this second check, the partial-unique constraint
   * `tts_configs_global_name_unique` would fire inside `update()` as a Prisma
   * P2002, surfacing to Express's default 500 handler.
   *
   * @param postIsGlobal - Whether the post-update state will be global. Only
   *   meaningful for USER scope; defaults false (admin/normal updates skip the
   *   global-namespace check).
   */
  async checkNameExists(
    name: string,
    scope: TtsConfigScope,
    excludeId?: string,
    postIsGlobal = false
  ): Promise<NameCheckResult> {
    const trimmedName = name.trim();
    const excludeClause = excludeId !== undefined ? { id: { not: excludeId } } : {};

    if (scope.type === 'GLOBAL') {
      const existing = await this.prisma.ttsConfig.findFirst({
        where: { name: trimmedName, isGlobal: true, ...excludeClause },
        select: { id: true },
      });
      return existing === null ? { exists: false } : { exists: true, conflictId: existing.id };
    }

    // USER scope: own-namespace always; global-namespace conditional.
    const ownPromise = this.prisma.ttsConfig.findFirst({
      where: { name: trimmedName, ownerId: scope.userId, ...excludeClause },
      select: { id: true },
    });

    if (!postIsGlobal) {
      const existing = await ownPromise;
      return existing === null ? { exists: false } : { exists: true, conflictId: existing.id };
    }

    const globalPromise = this.prisma.ttsConfig.findFirst({
      where: { name: trimmedName, isGlobal: true, ...excludeClause },
      select: { id: true },
    });
    const [own, global] = await Promise.all([ownPromise, globalPromise]);
    const existing = own ?? global;
    return { exists: existing !== null, conflictId: existing?.id };
  }

  /** Returns { blocker, warning }: blocker stops deletion; warning advises N users will have personal default SET NULL. Both fields can populate; route enforces precedence. */
  async checkDeleteConstraints(
    configId: string
  ): Promise<{ blocker: string | null; warning: string | null }> {
    // users.default_tts_config_id is ON DELETE SET NULL — delete works regardless,
    // but surfacing the count lets the admin confirm before silent-nulling N users.
    const [personalityCount, userOverrideCount, usersWithAsPersonalDefault] = await Promise.all([
      this.prisma.personalityDefaultTtsConfig.count({
        where: { ttsConfigId: configId },
      }),
      this.prisma.userPersonalityConfig.count({
        where: { ttsConfigId: configId },
      }),
      this.prisma.user.count({
        where: { defaultTtsConfigId: configId },
      }),
    ]);

    let blocker: string | null = null;
    if (personalityCount > 0) {
      blocker = `Cannot delete: TTS config is used as default by ${personalityCount} personality(ies)`;
    } else if (userOverrideCount > 0) {
      blocker = `Cannot delete: TTS config is used by ${userOverrideCount} user override(s)`;
    }

    const warning =
      usersWithAsPersonalDefault > 0
        ? `Deleting this TTS config will reset ${usersWithAsPersonalDefault} user(s)' personal default to NULL`
        : null;

    return { blocker, warning };
  }

  // --------------------------------------------------------------------------
  // Response Formatting
  // --------------------------------------------------------------------------

  /**
   * Format a raw config for API response. TTS has no Decimal fields, so
   * advancedParameters passes through as-is (defaulted to `{}` when null).
   */
  formatConfigDetail(raw: RawTtsConfigDetail): FormattedTtsConfigDetail {
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      provider: raw.provider,
      modelId: raw.modelId,
      isGlobal: raw.isGlobal,
      isDefault: raw.isDefault,
      isFreeDefault: raw.isFreeDefault,
      params: this.parseAdvancedParameters(raw.advancedParameters),
    };
  }

  /** Defensively coerce `advancedParameters` (Json | null) to a Record.
   *  Anything that isn't a plain object becomes `{}` so the response shape
   *  is stable regardless of legacy DB content. */
  private parseAdvancedParameters(raw: unknown): Record<string, unknown> {
    if (raw === null || raw === undefined) {
      return {};
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return {};
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /** Safely invalidate caches, logging but not throwing on failure. */
  private async invalidateCacheSafely(operation: string, configId: string): Promise<void> {
    if (!this.cacheInvalidation) {
      return;
    }
    try {
      await this.cacheInvalidation.invalidateAll();
      logger.debug({ configId, operation }, 'Invalidated TTS config caches');
    } catch (err) {
      logger.error({ err, configId, operation }, 'Failed to invalidate TTS config caches');
    }
  }
}
