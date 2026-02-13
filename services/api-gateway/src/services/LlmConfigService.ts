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
  type LlmConfigCacheInvalidationService,
  type LlmConfigCreateInput,
  type LlmConfigUpdateInput,
  LLM_CONFIG_LIST_SELECT,
  LLM_CONFIG_DETAIL_SELECT,
  LLM_CONFIG_DEFAULTS,
  generateLlmConfigUuid,
  createLogger,
  safeValidateAdvancedParams,
} from '@tzurot/common-types';

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
  visionModel: string | null;
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
  memoryScoreThreshold: { toNumber: () => number } | null;
  memoryLimit: number | null;
  contextWindowTokens: number;
  maxMessages: number;
  maxAge: number | null;
  maxImages: number;
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
  visionModel: string | null;
  isGlobal: boolean;
  isDefault: boolean;
  isFreeDefault: boolean;
  memoryScoreThreshold: number | null;
  memoryLimit: number | null;
  contextWindowTokens: number;
  maxMessages: number;
  maxAge: number | null;
  maxImages: number;
  params: Record<string, unknown>;
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
    }) as Promise<RawConfigDetail | null>;
  }

  /**
   * List configs based on scope.
   *
   * - GLOBAL scope: All configs (for admin view)
   * - USER scope: Global configs + user's own configs
   */
  async list(scope: LlmConfigScope): Promise<RawConfigList[]> {
    if (scope.type === 'GLOBAL') {
      // Admin: List all configs
      return this.prisma.llmConfig.findMany({
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
        where: { isGlobal: true },
        select: LLM_CONFIG_LIST_SELECT,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        take: 100,
      }),
      this.prisma.llmConfig.findMany({
        where: { ownerId: scope.userId, isGlobal: false },
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

    const config = await this.prisma.llmConfig.create({
      data: {
        id: generateLlmConfigUuid(data.name.trim()),
        name: data.name.trim(),
        description: data.description ?? null,
        ownerId,
        isGlobal,
        isDefault: false,
        provider: data.provider ?? LLM_CONFIG_DEFAULTS.provider,
        model: data.model.trim(),
        visionModel: data.visionModel ?? null,
        advancedParameters: data.advancedParameters ?? undefined,
        // Memory settings
        memoryScoreThreshold: data.memoryScoreThreshold ?? LLM_CONFIG_DEFAULTS.memoryScoreThreshold,
        memoryLimit: data.memoryLimit ?? LLM_CONFIG_DEFAULTS.memoryLimit,
        contextWindowTokens: data.contextWindowTokens ?? LLM_CONFIG_DEFAULTS.contextWindowTokens,
        // Context settings
        maxMessages: data.maxMessages ?? LLM_CONFIG_DEFAULTS.maxMessages,
        maxAge: data.maxAge ?? null,
        maxImages: data.maxImages ?? LLM_CONFIG_DEFAULTS.maxImages,
      },
      select: LLM_CONFIG_DETAIL_SELECT,
    });

    logger.info(
      { configId: config.id, name: config.name, scope: scope.type },
      'Created LLM config'
    );

    // Invalidate list caches
    await this.invalidateCacheSafely('create', config.id);

    return config as RawConfigDetail;
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
    if (data.visionModel !== undefined) {
      updateData.visionModel = data.visionModel;
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

    return config as RawConfigDetail;
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
      // Clear existing default
      await tx.llmConfig.updateMany({
        where: { isDefault: true },
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
      // Clear existing free default
      await tx.llmConfig.updateMany({
        where: { isFreeDefault: true },
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
   * @param name - Name to check
   * @param scope - Scope to check within (GLOBAL or USER)
   * @param excludeId - Optional ID to exclude (for update operations)
   * @returns Whether name exists and the conflicting ID if any
   */
  async checkNameExists(
    name: string,
    scope: LlmConfigScope,
    excludeId?: string
  ): Promise<NameCheckResult> {
    const trimmedName = name.trim();

    const whereClause: Record<string, unknown> = { name: trimmedName };

    if (scope.type === 'GLOBAL') {
      // Admin: Check among global configs only
      whereClause.isGlobal = true;
    } else {
      // User: Check among user's own configs
      whereClause.ownerId = scope.userId;
    }

    if (excludeId !== undefined) {
      whereClause.id = { not: excludeId };
    }

    const existing = await this.prisma.llmConfig.findFirst({
      where: whereClause,
      select: { id: true },
    });

    return {
      exists: existing !== null,
      conflictId: existing?.id,
    };
  }

  /**
   * Check if a config can be deleted.
   * Returns null if deletable, or an error message if not.
   *
   * @param configId - ID of config to check
   * @returns Error message or null if deletable
   */
  async checkDeleteConstraints(configId: string): Promise<string | null> {
    const [personalityCount, userOverrideCount] = await Promise.all([
      this.prisma.personalityDefaultConfig.count({
        where: { llmConfigId: configId },
      }),
      this.prisma.userPersonalityConfig.count({
        where: { llmConfigId: configId },
      }),
    ]);

    if (personalityCount > 0) {
      return `Cannot delete: config is used as default by ${personalityCount} personality(ies)`;
    }

    if (userOverrideCount > 0) {
      return `Cannot delete: config is used by ${userOverrideCount} user override(s)`;
    }

    return null;
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
      visionModel: raw.visionModel,
      isGlobal: raw.isGlobal,
      isDefault: raw.isDefault,
      isFreeDefault: raw.isFreeDefault,
      memoryScoreThreshold: raw.memoryScoreThreshold?.toNumber() ?? null,
      memoryLimit: raw.memoryLimit,
      contextWindowTokens: raw.contextWindowTokens,
      maxMessages: raw.maxMessages,
      maxAge: raw.maxAge,
      maxImages: raw.maxImages,
      params: safeValidateAdvancedParams(raw.advancedParameters) ?? {},
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
