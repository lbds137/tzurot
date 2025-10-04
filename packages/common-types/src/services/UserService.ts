/**
 * UserService
 * Manages User records - creates users on first interaction
 */

import { getPrismaClient } from './prisma.js';
import { createLogger } from '../logger.js';

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
        user = await this.prisma.user.create({
          data: {
            discordId,
            username
          },
          select: { id: true }
        });
        logger.info(`Created new user: ${username} (${discordId})`);
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
