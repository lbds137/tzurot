/**
 * UserService
 * Manages User records - creates users on first interaction
 */

import { Prisma } from '@prisma/client';
import { getPrismaClient } from './prisma.js';
import { createLogger } from '../logger.js';
import { generateUserUuid, generatePersonaUuid } from '../deterministic-uuid.js';

const logger = createLogger('UserService');

export class UserService {
  private prisma;
  private userCache: Map<string, string>; // discordId -> userId (UUID)

  constructor() {
    this.prisma = getPrismaClient();
    this.userCache = new Map();
  }

  /**
   * Get or create a user by Discord ID
   * Returns the user's UUID for use in foreign keys
   */
  async getOrCreateUser(discordId: string, username: string): Promise<string> {
    // Check cache first
    const cached = this.userCache.get(discordId);
    if (cached) {
      return cached;
    }

    try {
      // Try to find existing user
      let user = await this.prisma.user.findUnique({
        where: { discordId },
        select: { id: true }
      });

      // Create if doesn't exist
      if (!user) {
        // Generate deterministic UUIDs (same across all environments!)
        const userId = generateUserUuid(discordId);
        const personaId = generatePersonaUuid(`${username}'s Persona`, userId);

        // Create user, default persona, and link in a transaction
        await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          // Create user
          await tx.user.create({
            data: {
              id: userId,
              discordId,
              username
            }
          });

          // Create default persona for user
          await tx.persona.create({
            data: {
              id: personaId,
              name: `${username}'s Persona`,
              description: 'Default persona',
              content: 'A Discord user with no additional context provided',
              ownerId: userId
            }
          });

          // Link persona as user's default
          await tx.userDefaultPersona.create({
            data: {
              userId: userId,
              personaId: personaId,
              updatedAt: new Date()
            }
          });
        });

        logger.info(`Created new user: ${username} (${discordId}) with default persona`);

        user = { id: userId };
      }

      // Cache the result
      this.userCache.set(discordId, user.id);
      return user.id;

    } catch (error) {
      logger.error({ err: error }, `Failed to get/create user: ${discordId}`);
      throw error;
    }
  }

}
