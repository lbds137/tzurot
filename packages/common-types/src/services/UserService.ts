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
        select: { id: true, isSuperuser: true },
      });

      // Check if existing user should be promoted to superuser
      // This handles the case where BOT_OWNER_ID is set after user was created
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

      // Create if doesn't exist
      if (!user) {
        // Generate deterministic UUIDs (same across all environments!)
        const userId = generateUserUuid(discordId);
        const personaId = generatePersonaUuid(username, userId);

        // Auto-promote bot owner to superuser on first interaction
        const shouldBeSuperuser = isBotOwner(discordId);

        // Create user, default persona, and link in a transaction
        try {
          await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Create user
            logger.debug(
              { userId, discordId, username, isSuperuser: shouldBeSuperuser },
              '[UserService] Creating user record'
            );
            try {
              await tx.user.create({
                data: {
                  id: userId,
                  discordId,
                  username,
                  isSuperuser: shouldBeSuperuser,
                },
              });
              if (shouldBeSuperuser) {
                logger.info(
                  { userId, discordId, username },
                  '[UserService] Bot owner auto-promoted to superuser'
                );
              }
              logger.debug({ userId }, '[UserService] User record created successfully');
            } catch (userError) {
              logger.error(
                { err: userError, userId, discordId, username },
                '[UserService] FAILED to create user record'
              );
              throw userError;
            }

            // Create default persona for user
            // Use display name (e.g., "Alt Hime") as preferredName, fallback to username
            const personaDisplayName = displayName ?? username;
            // Use Discord bio if available, otherwise leave empty
            const personaContent = bio ?? '';
            logger.debug(
              { personaId, username, preferredName: personaDisplayName, ownerId: userId },
              '[UserService] Creating persona record'
            );
            try {
              await tx.persona.create({
                data: {
                  id: personaId,
                  name: username, // Keep username as identifier
                  preferredName: personaDisplayName, // Use display name for showing to AI
                  description: 'Default persona',
                  content: personaContent,
                  ownerId: userId,
                },
              });
              logger.debug({ personaId }, '[UserService] Persona record created successfully');
            } catch (personaError) {
              logger.error(
                { err: personaError, personaId, username, ownerId: userId },
                '[UserService] FAILED to create persona record'
              );
              throw personaError;
            }

            // Set persona as user's default
            logger.debug({ userId, personaId }, '[UserService] Setting user defaultPersonaId');
            try {
              await tx.user.update({
                where: { id: userId },
                data: { defaultPersonaId: personaId },
              });
              logger.debug(
                { userId, personaId },
                '[UserService] User defaultPersonaId set successfully'
              );
            } catch (linkError) {
              logger.error(
                { err: linkError, userId, personaId },
                '[UserService] FAILED to set user defaultPersonaId'
              );
              throw linkError;
            }
          });

          logger.info(
            `[UserService] Transaction completed: Created user ${username} (${discordId}) with default persona`
          );
        } catch (transactionError) {
          logger.error(
            {
              err: transactionError,
              userId,
              personaId,
              discordId,
              username,
            },
            '[UserService] Transaction FAILED - all changes should be rolled back'
          );
          throw transactionError;
        }

        user = { id: userId, isSuperuser: shouldBeSuperuser };
      }

      // Cache the result
      this.userCache.set(discordId, user.id);
      return user.id;
    } catch (error) {
      logger.error({ err: error }, `Failed to get/create user: ${discordId}`);
      throw error;
    }
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
