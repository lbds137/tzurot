/**
 * UUIDMapper - Handles UUID mapping between shapes.inc and v3
 *
 * Challenge: Three different UUID spaces
 * 1. Shapes.inc UUIDs (personality and user IDs from backup)
 * 2. V3 PostgreSQL UUIDs (new IDs for personalities/users/personas)
 * 3. Discord IDs (the bridge between systems - consistent across both)
 *
 * Strategy: Use Discord IDs as the linking key
 */

import type { PrismaClient } from '@tzurot/common-types';
import { UNKNOWN_USER_NAME } from '@tzurot/common-types';
import type { UUIDMapping } from './types.js';

export interface UserResolutionResult {
  resolved: boolean;
  shapesUserId: string; // Original shapes.inc UUID (for migration tracking)
  discordId: string | null;
  v3UserId: string | null;
  v3PersonaId: string | null;
  isOrphaned: boolean;
}

export class UUIDMapper {
  private prisma: PrismaClient;
  private orphanedPersonaId: string;

  // Cache mappings to avoid repeated database queries
  private discordIdToPersonaCache = new Map<string, string>();
  private shapesUserToDiscordCache = new Map<string, string | null>();

  constructor(options: { prisma: PrismaClient; orphanedPersonaId: string }) {
    this.prisma = options.prisma;
    this.orphanedPersonaId = options.orphanedPersonaId;
  }

  /**
   * Resolve shapes.inc user UUID to v3 persona UUID
   *
   * Flow:
   * 1. Check if we've already resolved this shapes.inc UUID (cache)
   * 2. Try to find Discord ID from shapes.inc data
   * 3. Look up v3 user by Discord ID
   * 4. Get user's default persona
   * 5. If can't resolve, mark as orphaned
   */
  async resolveUser(
    shapesUserId: string,
    shapesUserData?: {
      discordId?: string;
    }
  ): Promise<UserResolutionResult> {
    // Check cache first
    const cachedDiscordId = this.shapesUserToDiscordCache.get(shapesUserId);
    if (cachedDiscordId !== undefined) {
      if (cachedDiscordId === null) {
        // Previously failed to resolve
        return this.createOrphanedResult();
      }
      return this.resolveByDiscordId(cachedDiscordId);
    }

    // Try to get Discord ID from provided data
    const discordId = shapesUserData?.discordId;
    if (!discordId) {
      // No Discord ID available - mark as orphaned
      this.shapesUserToDiscordCache.set(shapesUserId, null);
      return this.createOrphanedResult();
    }

    // Cache the mapping
    this.shapesUserToDiscordCache.set(shapesUserId, discordId);

    // Resolve via Discord ID
    return this.resolveByDiscordId(discordId);
  }

  /**
   * Resolve Discord ID to v3 persona UUID
   */
  private async resolveByDiscordId(discordId: string): Promise<UserResolutionResult> {
    // Check persona cache
    const cachedPersonaId = this.discordIdToPersonaCache.get(discordId);
    if (cachedPersonaId) {
      return {
        resolved: true,
        discordId,
        v3UserId: null, // We don't cache user IDs, only persona IDs
        v3PersonaId: cachedPersonaId,
        isOrphaned: false,
      };
    }

    // Look up user in v3 database
    const user = await this.prisma.user.findUnique({
      where: { discordId },
      include: {
        defaultPersonaLink: {
          include: {
            persona: true,
          },
        },
      },
    });

    if (!user || !user.defaultPersonaLink) {
      // User doesn't exist in v3 yet - mark as orphaned
      return this.createOrphanedResult();
    }

    const personaId = user.defaultPersonaLink.personaId;

    // Cache the result
    this.discordIdToPersonaCache.set(discordId, personaId);

    return {
      resolved: true,
      discordId,
      v3UserId: user.id,
      v3PersonaId: personaId,
      isOrphaned: false,
    };
  }

  /**
   * Create result for orphaned user
   */
  private createOrphanedResult(): UserResolutionResult {
    return {
      resolved: false,
      discordId: null,
      v3UserId: null,
      v3PersonaId: this.orphanedPersonaId,
      isOrphaned: true,
    };
  }

  /**
   * Batch resolve multiple users
   * More efficient than resolving one at a time
   */
  async resolveUsers(
    shapesUserIds: string[],
    shapesUserDataMap?: Map<string, { discordId?: string }>
  ): Promise<Map<string, UserResolutionResult>> {
    const results = new Map<string, UserResolutionResult>();

    for (const shapesUserId of shapesUserIds) {
      const userData = shapesUserDataMap?.get(shapesUserId);
      const result = await this.resolveUser(shapesUserId, userData);
      results.set(shapesUserId, result);
    }

    return results;
  }

  /**
   * Create or get orphaned persona
   *
   * The orphaned persona is where we store memories when we can't resolve
   * the original user. Later, if users link their accounts, we can migrate
   * memories to their actual persona.
   */
  async ensureOrphanedPersona(ownerId: string): Promise<string> {
    // Check if orphaned persona already exists
    const existing = await this.prisma.persona.findUnique({
      where: { id: this.orphanedPersonaId },
    });

    if (existing) {
      return existing.id;
    }

    // Create orphaned persona
    const orphanedPersona = await this.prisma.persona.create({
      data: {
        id: this.orphanedPersonaId,
        name: 'Orphaned Memories',
        description: 'Memories from shapes.inc import that could not be linked to specific users',
        content:
          'This persona contains memories from the shapes.inc import where the original user could not be identified.',
        preferredName: UNKNOWN_USER_NAME,
        ownerId: ownerId, // Bot owner or system user
      },
    });

    return orphanedPersona.id;
  }

  /**
   * Get statistics about resolution success
   */
  getStats(): {
    totalAttempts: number;
    resolved: number;
    orphaned: number;
    cacheSize: number;
  } {
    const totalAttempts = this.shapesUserToDiscordCache.size;
    const orphaned = Array.from(this.shapesUserToDiscordCache.values()).filter(
      v => v === null
    ).length;
    const resolved = totalAttempts - orphaned;

    return {
      totalAttempts,
      resolved,
      orphaned,
      cacheSize: this.discordIdToPersonaCache.size,
    };
  }

  /**
   * Clear caches (useful for testing or memory management)
   */
  clearCache(): void {
    this.discordIdToPersonaCache.clear();
    this.shapesUserToDiscordCache.clear();
  }
}
