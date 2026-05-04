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

import {
  Prisma,
  type PrismaClient,
  type TtsConfigCacheInvalidationService,
  type TtsConfigCreateInput,
  type TtsConfigUpdateInput,
  TTS_CONFIG_LIST_SELECT,
  TTS_CONFIG_DETAIL_SELECT,
  TTS_CONFIG_DEFAULTS,
  newTtsConfigId,
  generateClonedName,
  stripCopySuffix,
  isTtsProviderId,
  createLogger,
} from '@tzurot/common-types';

import { isPrismaUniqueConstraintErrorOn } from '../utils/prismaErrors.js';
import {
  TtsCloneNameExhaustedError,
  TtsAutoSuffixCollisionError,
  TtsInvalidProviderError,
} from './TtsConfigErrors.js';

const logger = createLogger('TtsConfigService');

// ============================================================================
// Types
// ============================================================================

/**
 * Scope for TTS config operations. Determines access control and which
 * configs are visible.
 */
export type TtsConfigScope =
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
 * Raw config from Prisma query (list select). Mirrors LlmConfig's list shape
 * minus the LLM-only fields (no `model`, `visionModel`, memory/context).
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

/**
 * Raw config from Prisma query (detail select).
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

// ============================================================================
// System globals seed shape (bootstrap path)
// ----------------------------------------------------------------------------
// Mirrors the seed in `prisma/migrations/20260502185237_add_tts_configs_cascade/
// migration.sql` lines 88-128. Bootstrap fires when `list(GLOBAL)` returns
// empty, fixing the fresh-DB-without-superuser-at-migration-time gap (filed
// in inbox.md from PR #958).
// ============================================================================

interface SystemGlobalSeed {
  name: string;
  description: string;
  provider: 'self-hosted' | 'elevenlabs' | 'mistral';
  modelId: string | null;
  isFreeDefault: boolean;
  /** When true, this seed is also marked as the system-wide default
   *  (`isDefault: true`). Set on `kyutai-self-hosted` so a fresh dev DB
   *  has a working TTS default out of the box without a manual admin step. */
  isDefault: boolean;
}

const SYSTEM_GLOBALS: readonly SystemGlobalSeed[] = [
  {
    name: 'kyutai-self-hosted',
    description: 'Self-hosted Kyutai/Pocket TTS — free tier + system default',
    provider: 'self-hosted',
    modelId: null,
    isFreeDefault: true,
    isDefault: true,
  },
  {
    name: 'elevenlabs-multilingual-v2',
    description: 'ElevenLabs Multilingual v2 — historic default for BYOK users',
    provider: 'elevenlabs',
    modelId: 'eleven_multilingual_v2',
    isFreeDefault: false,
    isDefault: false,
  },
  {
    name: 'mistral-voxtral-mini',
    description: 'Mistral Voxtral Mini TTS — Phase 1 BYOK (~85% cost reduction vs ElevenLabs)',
    provider: 'mistral',
    modelId: 'voxtral-mini-tts-2603',
    isFreeDefault: false,
    isDefault: false,
  },
];

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

  /** Get a single config by ID. Returns null if not found. */
  async getById(configId: string): Promise<RawTtsConfigDetail | null> {
    return this.prisma.ttsConfig.findUnique({
      where: { id: configId },
      select: TTS_CONFIG_DETAIL_SELECT,
    });
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
        return configs;
      }
      // Empty result → attempt bootstrap, then re-query
      await this.bootstrapSystemGlobalsIfNeeded();
      return this.queryGlobalConfigs();
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
      await this.bootstrapSystemGlobalsIfNeeded();
      const seeded = await this.queryGlobalConfigs();
      return [...seeded, ...userConfigs];
    }

    return [...globalConfigs, ...userConfigs];
  }

  private async queryGlobalConfigs(): Promise<RawTtsConfigList[]> {
    return this.prisma.ttsConfig.findMany({
      where: { isGlobal: true },
      select: TTS_CONFIG_LIST_SELECT,
      orderBy: [
        { isDefault: 'desc' },
        { isFreeDefault: 'desc' },
        { isGlobal: 'desc' },
        { name: 'asc' },
      ],
      take: 100,
    });
  }

  /**
   * Seed the 3 system globals if no global TtsConfigs exist yet AND a
   * superuser is available to own them. No-op if either precondition fails
   * (caller still gets `[]` from the subsequent re-query — which is the
   * correct state for a DB without a superuser).
   *
   * Race safety: `createMany({ skipDuplicates: true })` compiles to
   * `INSERT ... ON CONFLICT DO NOTHING` on Postgres, so two concurrent
   * first-callers converge cleanly without either failing.
   */
  private async bootstrapSystemGlobalsIfNeeded(): Promise<void> {
    const superuser = await this.prisma.user.findFirst({
      where: { isSuperuser: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (superuser === null) {
      logger.warn(
        {},
        'TtsConfig bootstrap skipped: no superuser exists yet — create one before invoking /settings tts'
      );
      return;
    }

    const result = await this.prisma.ttsConfig.createMany({
      data: SYSTEM_GLOBALS.map(seed => ({
        id: newTtsConfigId(),
        name: seed.name,
        description: seed.description,
        ownerId: superuser.id,
        isGlobal: true,
        isDefault: seed.isDefault,
        isFreeDefault: seed.isFreeDefault,
        provider: seed.provider,
        modelId: seed.modelId,
      })),
      skipDuplicates: true,
    });

    if (result.count > 0) {
      logger.info(
        { seeded: result.count, ownerId: superuser.id },
        'Bootstrapped TtsConfig system globals on first list() call'
      );
    }
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
          isDefault: false,
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
    return config;
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
    return config;
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

  /** Set a config as the system default. Clears any existing default first. */
  async setAsDefault(configId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.ttsConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
      await tx.ttsConfig.update({
        where: { id: configId },
        data: { isDefault: true },
      });
    });
    logger.info({ configId }, 'Set TTS config as system default');
    await this.invalidateCacheSafely('set-default', configId);
  }

  /** Set a config as the free tier default. Clears any existing free default first. */
  async setAsFreeDefault(configId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.ttsConfig.updateMany({
        where: { isFreeDefault: true },
        data: { isFreeDefault: false },
      });
      await tx.ttsConfig.update({
        where: { id: configId },
        data: { isFreeDefault: true },
      });
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

  /**
   * Check if a config can be deleted. Returns null if deletable, or an error
   * message if it's still referenced by personalities or user overrides.
   */
  async checkDeleteConstraints(configId: string): Promise<string | null> {
    const [personalityCount, userOverrideCount] = await Promise.all([
      this.prisma.personalityDefaultTtsConfig.count({
        where: { ttsConfigId: configId },
      }),
      this.prisma.userPersonalityConfig.count({
        where: { ttsConfigId: configId },
      }),
    ]);

    if (personalityCount > 0) {
      return `Cannot delete: TTS config is used as default by ${personalityCount} personality(ies)`;
    }
    if (userOverrideCount > 0) {
      return `Cannot delete: TTS config is used by ${userOverrideCount} user override(s)`;
    }
    return null;
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
