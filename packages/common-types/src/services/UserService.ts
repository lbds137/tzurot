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
  private personaCache: Map<string, string>; // userId:personalityId -> personaId

  constructor(private prisma: PrismaClient) {
    this.userCache = new Map();
    this.personaCache = new Map();
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

            // Link persona as user's default
            logger.debug({ userId, personaId }, '[UserService] Creating userDefaultPersona link');
            try {
              await tx.userDefaultPersona.create({
                data: {
                  userId: userId,
                  personaId: personaId,
                  updatedAt: new Date(),
                },
              });
              logger.debug(
                { userId, personaId },
                '[UserService] UserDefaultPersona link created successfully'
              );
            } catch (linkError) {
              logger.error(
                { err: linkError, userId, personaId },
                '[UserService] FAILED to create userDefaultPersona link'
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

  /**
   * Get the personaId for a user when interacting with a specific personality
   * Checks for personality-specific persona override, falls back to default persona
   *
   * @param userId User's UUID
   * @param personalityId Personality's UUID
   * @returns PersonaId to use for this interaction
   */
  async getPersonaForUser(userId: string, personalityId: string): Promise<string> {
    // Check cache first
    const cacheKey = `${userId}:${personalityId}`;
    const cached = this.personaCache.get(cacheKey);
    if (cached !== undefined && cached.length > 0) {
      return cached;
    }

    try {
      // 1. Check for personality-specific persona override
      const userConfig = await this.prisma.userPersonalityConfig.findUnique({
        where: {
          userId_personalityId: {
            userId,
            personalityId,
          },
        },
        select: {
          personaId: true,
        },
      });

      if (
        userConfig?.personaId !== null &&
        userConfig?.personaId !== undefined &&
        userConfig.personaId.length > 0
      ) {
        logger.debug(
          `Using personality-specific persona for user ${userId.substring(0, 8)}... with personality ${personalityId.substring(0, 8)}...`
        );
        this.personaCache.set(cacheKey, userConfig.personaId);
        return userConfig.personaId;
      }

      // 2. Fall back to user's default persona
      const defaultPersona = await this.prisma.userDefaultPersona.findUnique({
        where: {
          userId,
        },
        select: {
          personaId: true,
        },
      });

      if (
        defaultPersona?.personaId === null ||
        defaultPersona?.personaId === undefined ||
        defaultPersona?.personaId.length === 0
      ) {
        // This should never happen since we create default personas in getOrCreateUser
        throw new Error(`No default persona found for user ${userId}`);
      }

      logger.debug(`Using default persona for user ${userId.substring(0, 8)}...`);
      this.personaCache.set(cacheKey, defaultPersona.personaId);
      return defaultPersona.personaId;
    } catch (error) {
      logger.error(
        { err: error },
        `Failed to get persona for user ${userId} with personality ${personalityId}`
      );
      throw error;
    }
  }
}
