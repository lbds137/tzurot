/**
 * UserService
 * Manages User records - creates users on first interaction
 *
 * Key behaviors:
 * - Creates users with default personas atomically via transactions
 * - Handles race conditions when multiple requests arrive for same user
 * - Backfills default personas for legacy users created without them
 * - Updates placeholder usernames (discordId) to real usernames
 */

import type { PrismaClient } from './prisma.js';
import { Prisma } from './prisma.js';
import { createLogger } from '../utils/logger.js';
import { TTLCache } from '../utils/TTLCache.js';
import { generateUserUuid, generatePersonaUuid } from '../utils/deterministicUuid.js';
import { isBotOwner } from '../utils/ownerMiddleware.js';
import { UNKNOWN_USER_DISCORD_ID } from '../constants/message.js';

/** User record with fields needed for backfill checks */
interface UserWithBackfillFields {
  id: string;
  isSuperuser: boolean;
  username: string;
  defaultPersonaId: string | null;
}

const logger = createLogger('UserService');

/** Default description for auto-created personas */
const DEFAULT_PERSONA_DESCRIPTION = 'Default persona';

/** Cache TTL: 1 hour - users rarely change, but we want eventual consistency */
const USER_CACHE_TTL_MS = 60 * 60 * 1000;

/** Max cache size: 10,000 users - prevents unbounded memory growth */
const USER_CACHE_MAX_SIZE = 10_000;

export class UserService {
  /** Cache discordId -> userId (UUID) with TTL to prevent memory leaks */
  private userCache: TTLCache<string>;

  constructor(private prisma: PrismaClient) {
    this.userCache = new TTLCache<string>({
      ttl: USER_CACHE_TTL_MS,
      maxSize: USER_CACHE_MAX_SIZE,
    });
  }

  /**
   * Get or create a user by Discord ID
   * Returns the user's UUID for use in foreign keys, or null if the user is a bot
   * @param discordId Discord user ID
   * @param username Discord username (e.g., "alt_hime")
   * @param displayName Discord display name (e.g., "Alt Hime") - falls back to username if not provided
   * @param bio Discord user's profile bio/about me - if provided, used for persona content
   * @param isBot Whether the user is a Discord bot - if true, returns null without creating a record
   */
  async getOrCreateUser(
    discordId: string,
    username: string,
    displayName?: string,
    bio?: string,
    isBot?: boolean
  ): Promise<string | null> {
    // Skip user creation for bots - they shouldn't have user records or personas
    if (isBot === true) {
      logger.debug({ discordId, username }, 'Skipping user creation for bot');
      return null;
    }

    // Check cache first
    const cached = this.userCache.get(discordId);
    if (cached !== null) {
      return cached;
    }

    try {
      // Try to find existing user
      let user: UserWithBackfillFields | null = await this.prisma.user.findUnique({
        where: { discordId },
        select: { id: true, isSuperuser: true, username: true, defaultPersonaId: true },
      });

      // Create if doesn't exist (with race condition handling)
      user ??= await this.createUserWithRaceProtection(discordId, username, displayName, bio);

      // Run maintenance tasks for existing users (backfill, promotions, etc.)
      await this.runMaintenanceTasks(user, discordId, username, displayName, bio);

      // Cache the result
      this.userCache.set(discordId, user.id);
      return user.id;
    } catch (error) {
      logger.error({ err: error, discordId }, 'Failed to get/create user');
      throw error;
    }
  }

  /**
   * Create user with race condition protection
   * If two requests try to create the same user simultaneously, one will fail with P2002.
   * We catch that and fetch the existing user instead.
   */
  private async createUserWithRaceProtection(
    discordId: string,
    username: string,
    displayName?: string,
    bio?: string
  ): Promise<UserWithBackfillFields> {
    try {
      return await this.createUserWithDefaultPersona(discordId, username, displayName, bio);
    } catch (error) {
      // P2002 is Prisma's unique constraint violation error
      // Use duck typing to check for Prisma error (safer than instanceof in test environments)
      if (this.isPrismaUniqueConstraintError(error)) {
        logger.warn(
          { discordId },
          'Race condition detected during user creation, fetching existing user'
        );
        // Another request created the user - fetch it
        const existingUser = await this.prisma.user.findUnique({
          where: { discordId },
          select: { id: true, isSuperuser: true, username: true, defaultPersonaId: true },
        });
        if (existingUser === null) {
          // This shouldn't happen - P2002 means the record exists
          throw new Error(`User not found after P2002 error for discordId: ${discordId}`, {
            cause: error,
          });
        }
        return existingUser;
      }
      throw error;
    }
  }

  /**
   * Check if an error is a Prisma unique constraint violation (P2002)
   * Uses duck typing to avoid instanceof issues in test environments
   */
  private isPrismaUniqueConstraintError(error: unknown): boolean {
    return error !== null && typeof error === 'object' && 'code' in error && error.code === 'P2002';
  }

  /**
   * Run maintenance tasks for existing users
   * Handles backfilling personas, promoting superusers, and updating placeholder usernames.
   * These are "read-repair" operations that fix legacy data on access.
   */
  private async runMaintenanceTasks(
    user: UserWithBackfillFields,
    discordId: string,
    username: string,
    displayName?: string,
    bio?: string
  ): Promise<void> {
    // Check if existing user should be promoted to superuser
    await this.promoteToSuperuserIfNeeded(user, discordId);

    // Backfill default persona if missing
    // (api-gateway creates users without personas via direct prisma calls)
    if (user.defaultPersonaId === null) {
      await this.backfillDefaultPersona(user.id, username, displayName, bio);
    }

    // Update placeholder username if we now have a real username
    // Only updates usernames that exactly match discordId (placeholder pattern).
    // This intentionally does NOT sync changed Discord usernames - we preserve
    // the username from first interaction to maintain historical consistency.
    if (user.username === discordId && username !== discordId) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { username },
      });
      logger.info(
        { userId: user.id, discordId, oldUsername: user.username, newUsername: username },
        'Updated placeholder username'
      );
    }
  }

  /**
   * Promote existing user to superuser if they are the bot owner
   * Handles the case where BOT_OWNER_ID is set after user was created
   */
  private async promoteToSuperuserIfNeeded(
    user: UserWithBackfillFields | null,
    discordId: string
  ): Promise<void> {
    if (user && !user.isSuperuser && isBotOwner(discordId)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { isSuperuser: true },
      });
      logger.info({ userId: user.id, discordId }, 'Promoted existing user to superuser');
    }
  }

  /**
   * Backfill default persona for existing user who doesn't have one.
   * This handles users created via api-gateway's direct prisma calls.
   *
   * Race condition handling: If two requests try to backfill simultaneously,
   * both may pass the findUnique check before either commits. The second will
   * get a P2002 error on persona.create (deterministic UUIDs = same persona ID).
   * We catch this inside the transaction and continue to updateMany, which is
   * idempotent and will link the existing persona if not already linked.
   */
  private async backfillDefaultPersona(
    userId: string,
    username: string,
    displayName?: string,
    bio?: string
  ): Promise<void> {
    const personaId = generatePersonaUuid(username, userId);
    const personaDisplayName = displayName ?? username;
    const personaContent = bio ?? '';

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Double-check inside transaction that persona is still needed
      // (another request may have created it between our check and this transaction)
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { defaultPersonaId: true },
      });

      if (user?.defaultPersonaId !== null) {
        // Another request already backfilled - nothing to do
        return;
      }

      // Create default persona (with P2002 race handling)
      // If two requests pass the findUnique check simultaneously, both will try
      // to create the same persona (deterministic UUID). The second gets P2002.
      try {
        await tx.persona.create({
          data: {
            id: personaId,
            name: username,
            preferredName: personaDisplayName,
            description: DEFAULT_PERSONA_DESCRIPTION,
            content: personaContent,
            ownerId: userId,
          },
        });
      } catch (error) {
        if (this.isPrismaUniqueConstraintError(error)) {
          logger.debug(
            { userId, personaId },
            'Persona already created by concurrent request, continuing to link'
          );
          // Continue to updateMany - it's idempotent and will link the existing persona
        } else {
          throw error;
        }
      }

      // Link persona as user's default (idempotent - only updates if still null)
      await tx.user.updateMany({
        where: { id: userId, defaultPersonaId: null },
        data: { defaultPersonaId: personaId },
      });
    });

    logger.info({ userId, username, personaId }, 'Backfilled default persona for existing user');
  }

  /**
   * Create a new user with their default persona in a transaction
   */
  private async createUserWithDefaultPersona(
    discordId: string,
    username: string,
    displayName?: string,
    bio?: string
  ): Promise<UserWithBackfillFields> {
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
        logger.info({ userId, discordId, username }, 'Bot owner auto-promoted to superuser');
      }

      // Create default persona
      await tx.persona.create({
        data: {
          id: personaId,
          name: username,
          preferredName: personaDisplayName,
          description: DEFAULT_PERSONA_DESCRIPTION,
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

    logger.info({ userId, discordId, username, personaId }, 'Created user with default persona');

    return {
      id: userId,
      isSuperuser: shouldBeSuperuser,
      username,
      defaultPersonaId: personaId,
    };
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

  /**
   * Get or create multiple users in batch
   * Used for extended context participants to ensure proper personas exist
   *
   * Filters out:
   * - Bots (isBot: true)
   * - Unknown users (discordId === UNKNOWN_USER_DISCORD_ID) from forwarded messages
   *
   * @param users - Array of user info from extended context
   * @returns Map of discordId to userId (UUID), excluding filtered users
   */
  async getOrCreateUsersInBatch(
    users: {
      discordId: string;
      username: string;
      displayName?: string;
      isBot: boolean;
    }[]
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    // Filter out bots and unknown users
    const validUsers = users.filter(u => !u.isBot && u.discordId !== UNKNOWN_USER_DISCORD_ID);

    if (validUsers.length === 0) {
      return result;
    }

    // Process in batches of 10 to avoid overwhelming the database
    const BATCH_SIZE = 10;
    for (let i = 0; i < validUsers.length; i += BATCH_SIZE) {
      const batch = validUsers.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async user => {
          try {
            const userId = await this.getOrCreateUser(
              user.discordId,
              user.username,
              user.displayName,
              undefined, // bio
              user.isBot
            );
            return { discordId: user.discordId, userId };
          } catch (error) {
            // Log but don't fail the entire batch for one user
            logger.warn(
              { err: error, discordId: user.discordId },
              'Failed to get/create user in batch, continuing with others'
            );
            return { discordId: user.discordId, userId: null };
          }
        })
      );

      // Collect successful results
      for (const { discordId, userId } of batchResults) {
        if (userId !== null) {
          result.set(discordId, userId);
        }
      }
    }

    logger.debug(
      { requested: validUsers.length, created: result.size },
      'Batch user creation completed'
    );

    return result;
  }
}
