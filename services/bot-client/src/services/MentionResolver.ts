/**
 * MentionResolver
 *
 * Resolves Discord user mentions in message content.
 * For each mentioned user:
 * - Looks up or creates their default persona
 * - Replaces <@userId> with the persona's display name
 * - Returns info about mentioned users for inclusion in conversation context
 */

import type { PrismaClient } from '@tzurot/common-types';
import type { Collection, User } from 'discord.js';
import { UserService, createLogger, DISCORD_MENTIONS } from '@tzurot/common-types';

const logger = createLogger('MentionResolver');

/**
 * Information about a mentioned user's persona
 */
export interface MentionedUserInfo {
  /** Discord user ID */
  discordId: string;
  /** User's database UUID */
  userId: string;
  /** Persona's database UUID */
  personaId: string;
  /** Display name used in message replacement */
  personaName: string;
}

/**
 * Result of resolving mentions in a message
 */
export interface MentionResolutionResult {
  /** Message content with mentions replaced by names */
  processedContent: string;
  /** Information about mentioned users */
  mentionedUsers: MentionedUserInfo[];
}

/**
 * Resolves Discord user mentions to persona names
 */
export class MentionResolver {
  private userService: UserService;

  constructor(private prisma: PrismaClient) {
    this.userService = new UserService(prisma);
  }

  /**
   * Resolve user mentions in message content
   *
   * @param content - Message content containing mentions like <@123456>
   * @param mentionedUsers - Collection of User objects from message.mentions.users
   * @param personalityId - The personality ID for persona lookup
   * @returns Processed content and info about mentioned users
   */
  async resolveMentions(
    content: string,
    mentionedUsers: Collection<string, User>,
    personalityId: string
  ): Promise<MentionResolutionResult> {
    // Create regex for Discord user mentions (both <@123> and <@!123> formats)
    const mentionRegex = new RegExp(DISCORD_MENTIONS.USER_PATTERN, 'g');

    // Find all mentions
    const matches = [...content.matchAll(mentionRegex)];

    if (matches.length === 0) {
      return {
        processedContent: content,
        mentionedUsers: [],
      };
    }

    logger.debug(
      { mentionCount: matches.length },
      '[MentionResolver] Found user mentions to resolve'
    );

    // Extract unique Discord IDs from matches
    const allUniqueIds = [...new Set(matches.map(m => m[1]))];

    if (allUniqueIds.length < matches.length) {
      logger.debug(
        { totalMentions: matches.length, uniqueUsers: allUniqueIds.length },
        '[MentionResolver] Deduplicated mention IDs'
      );
    }

    // Limit to MAX_PER_MESSAGE for DoS prevention
    const uniqueIds =
      allUniqueIds.length > DISCORD_MENTIONS.MAX_PER_MESSAGE
        ? allUniqueIds.slice(0, DISCORD_MENTIONS.MAX_PER_MESSAGE)
        : allUniqueIds;

    if (allUniqueIds.length > DISCORD_MENTIONS.MAX_PER_MESSAGE) {
      logger.warn(
        {
          uniqueMentions: allUniqueIds.length,
          limit: DISCORD_MENTIONS.MAX_PER_MESSAGE,
        },
        '[MentionResolver] Unique mentions exceed limit, processing only first batch'
      );
    }

    // Build a map of discordId -> userInfo
    const userInfoMap = new Map<string, MentionedUserInfo>();

    for (const discordId of uniqueIds) {
      // Try to get Discord user info from the mentions collection
      const discordUser = mentionedUsers.get(discordId);

      if (discordUser) {
        // User is available - get or create their persona
        const userInfo = await this.resolveKnownUser(discordUser, personalityId);
        if (userInfo) {
          userInfoMap.set(discordId, userInfo);
        }
      } else {
        // User not in mentions collection - try to look up from our database
        const existingInfo = await this.lookupExistingUser(discordId, personalityId);
        if (existingInfo) {
          userInfoMap.set(discordId, existingInfo);
        } else {
          // Unknown user - leave the mention as-is
          logger.debug(
            { discordId },
            '[MentionResolver] Could not resolve mention - user not in shared server or database'
          );
        }
      }
    }

    // Now do all replacements - replace BOTH formats for each user
    let processedContent = content;
    for (const [discordId, userInfo] of userInfoMap) {
      const normalTag = `<@${discordId}>`;
      const nickTag = `<@!${discordId}>`;
      const replacement = `@${userInfo.personaName}`;

      // Replace both mention formats for this user
      processedContent = processedContent.replaceAll(normalTag, replacement);
      processedContent = processedContent.replaceAll(nickTag, replacement);
    }

    logger.debug(
      {
        resolvedCount: userInfoMap.size,
        totalMentions: uniqueIds.length,
      },
      '[MentionResolver] Mention resolution complete'
    );

    return {
      processedContent,
      mentionedUsers: Array.from(userInfoMap.values()),
    };
  }

  /**
   * Resolve a user that we have Discord info for
   */
  private async resolveKnownUser(
    discordUser: User,
    personalityId: string
  ): Promise<MentionedUserInfo | null> {
    try {
      const displayName = discordUser.globalName ?? discordUser.username;

      // Get or create user + default persona
      const userId = await this.userService.getOrCreateUser(
        discordUser.id,
        discordUser.username,
        displayName
      );

      // Get persona for this user + personality combination
      const personaId = await this.userService.getPersonaForUser(userId, personalityId);
      const personaName = await this.userService.getPersonaName(personaId);

      return {
        discordId: discordUser.id,
        userId,
        personaId,
        personaName: personaName ?? displayName,
      };
    } catch (error) {
      logger.error(
        { err: error, discordId: discordUser.id },
        '[MentionResolver] Failed to resolve known user'
      );
      return null;
    }
  }

  /**
   * Look up a user from our database (fallback when Discord info unavailable)
   */
  private async lookupExistingUser(
    discordId: string,
    personalityId: string
  ): Promise<MentionedUserInfo | null> {
    try {
      // Try to find user by Discord ID
      const user = await this.prisma.user.findUnique({
        where: { discordId },
        select: { id: true, username: true },
      });

      if (!user) {
        return null;
      }

      // Get their persona for this personality
      const personaId = await this.userService.getPersonaForUser(user.id, personalityId);
      const personaName = await this.userService.getPersonaName(personaId);

      return {
        discordId,
        userId: user.id,
        personaId,
        personaName: personaName ?? user.username,
      };
    } catch (error) {
      logger.error({ err: error, discordId }, '[MentionResolver] Failed to look up existing user');
      return null;
    }
  }
}
