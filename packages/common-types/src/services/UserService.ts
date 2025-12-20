/**
 * UserService
 * Manages User records - creates users on first interaction
 */

import type { PrismaClient } from './prisma.js';
import { Prisma } from './prisma.js';
import { createLogger } from '../utils/logger.js';
import { generateUserUuid, generatePersonaUuid } from '../utils/deterministicUuid.js';
import { isBotOwner } from '../utils/ownerMiddleware.js';

const logger = createLogger('UserService');

export class UserService {
  private userCache: Map<string, string>; // discordId -> userId (UUID)

  constructor(private prisma: PrismaClient) {
    this.userCache = new Map();
  }

  /**
   * Get or create a user by Discord ID
   * Returns the user's UUID for use in foreign keys
   * @param discordId Discord user ID
   * @param username Discord username (e.g., "alt_hime")
   * @param displayName Discord display name (e.g., "Alt Hime") - falls back to username if not provided
   * @param bio Discord user's profile bio/about me - if provided, used for persona content
   */
  async getOrCreateUser(
    discordId: string,
    username: string,
    displayName?: string,
    bio?: string
  ): Promise<string> {
    // Check cache first
    const cached = this.userCache.get(discordId);
    if (cached !== undefined && cached.length > 0) {
      return cached;
    }

    try {
      // Try to find existing user
      let user = await this.prisma.user.findUnique({
        where: { discordId },
        select: { id: true, isSuperuser: true, username: true },
      });

      // Check if existing user should be promoted to superuser
      await this.promoteToSuperuserIfNeeded(user, discordId);

      // Update placeholder username if we now have a real username
      // (api-gateway creates users with discordId as placeholder username)
      if (user && user.username === discordId && username !== discordId) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { username },
        });
        logger.info(
          { userId: user.id, discordId, oldUsername: user.username, newUsername: username },
          '[UserService] Updated placeholder username'
        );
      }

      // Create if doesn't exist
      user ??= await this.createUserWithDefaultPersona(discordId, username, displayName, bio);

      // Cache the result
      this.userCache.set(discordId, user.id);
      return user.id;
    } catch (error) {
      logger.error({ err: error }, `Failed to get/create user: ${discordId}`);
      throw error;
    }
  }

  /**
   * Promote existing user to superuser if they are the bot owner
   * Handles the case where BOT_OWNER_ID is set after user was created
   */
  private async promoteToSuperuserIfNeeded(
    user: { id: string; isSuperuser: boolean; username: string } | null,
    discordId: string
  ): Promise<void> {
    if (user && !user.isSuperuser && isBotOwner(discordId)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { isSuperuser: true },
      });
      logger.info(
        { userId: user.id, discordId },
        '[UserService] Promoted existing user to superuser'
      );
    }
  }

  /**
   * Create a new user with their default persona in a transaction
   */
  private async createUserWithDefaultPersona(
    discordId: string,
    username: string,
    displayName?: string,
    bio?: string
  ): Promise<{ id: string; isSuperuser: boolean }> {
    const userId = generateUserUuid(discordId);
    const personaId = generatePersonaUuid(username, userId);
    const shouldBeSuperuser = isBotOwner(discordId);
    const personaDisplayName = displayName ?? username;
    const personaContent = bio ?? '';

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create user
      await tx.user.create({
        data: { id: userId, discordId, username, isSuperuser: shouldBeSuperuser },
      });
      if (shouldBeSuperuser) {
        logger.info(
          { userId, discordId, username },
          '[UserService] Bot owner auto-promoted to superuser'
        );
      }

      // Create default persona
      await tx.persona.create({
        data: {
          id: personaId,
          name: username,
          preferredName: personaDisplayName,
          description: 'Default persona',
          content: personaContent,
          ownerId: userId,
        },
      });

      // Link persona as user's default
      await tx.user.update({
        where: { id: userId },
        data: { defaultPersonaId: personaId },
      });
    });

    logger.info(
      { userId, discordId, username, personaId },
      '[UserService] Created user with default persona'
    );

    return { id: userId, isSuperuser: shouldBeSuperuser };
  }

  /**
   * Get user's timezone preference
   * @param userId User's internal UUID
   * @returns User's timezone (IANA format) or 'UTC' if not set
   */
  async getUserTimezone(userId: string): Promise<string> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
      return user?.timezone ?? 'UTC';
    } catch (error) {
      logger.error({ err: error }, `Failed to get timezone for user ${userId}`);
      return 'UTC'; // Default to UTC on error
    }
  }

  /**
   * Get persona name by ID
   * @param personaId Persona UUID
   * @returns Persona name (preferredName if set, otherwise name)
   */
  async getPersonaName(personaId: string): Promise<string | null> {
    try {
      const persona = await this.prisma.persona.findUnique({
        where: { id: personaId },
        select: {
          name: true,
          preferredName: true,
        },
      });

      if (!persona) {
        return null;
      }

      return persona.preferredName ?? persona.name;
    } catch (error) {
      logger.error({ err: error }, `Failed to get persona name for ${personaId}`);
      return null;
    }
  }
}
