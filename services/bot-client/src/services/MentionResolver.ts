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
import { UserService, createLogger } from '@tzurot/common-types';

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
    const mentionedUserInfos: MentionedUserInfo[] = [];

    // Regex for Discord user mentions: <@123456> or <@!123456> (with nickname indicator)
    const mentionRegex = /<@!?(\d+)>/g;

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

    let processedContent = content;

    // Process each unique mention
    const processedIds = new Set<string>();

    for (const match of matches) {
      const fullTag = match[0]; // e.g., "<@123456>" or "<@!123456>"
      const discordId = match[1]; // e.g., "123456"

      // Skip if we've already processed this user
      if (processedIds.has(discordId)) {
        continue;
      }
      processedIds.add(discordId);

      // Try to get Discord user info from the mentions collection
      const discordUser = mentionedUsers.get(discordId);

      if (discordUser) {
        // User is available - get or create their persona
        const userInfo = await this.resolveKnownUser(discordUser, personalityId);

        if (userInfo) {
          mentionedUserInfos.push(userInfo);
          // Replace all occurrences of this mention with the persona name
          processedContent = processedContent.split(fullTag).join(`@${userInfo.personaName}`);

          // Also handle the alternate format (with !)
          const altTag = fullTag.includes('!')
            ? fullTag.replace('!', '')
            : fullTag.replace('@', '@!');
          processedContent = processedContent.split(altTag).join(`@${userInfo.personaName}`);
        }
      } else {
        // User not in mentions collection - try to look up from our database
        const existingInfo = await this.lookupExistingUser(discordId, personalityId);

        if (existingInfo) {
          mentionedUserInfos.push(existingInfo);
          processedContent = processedContent.split(fullTag).join(`@${existingInfo.personaName}`);

          const altTag = fullTag.includes('!')
            ? fullTag.replace('!', '')
            : fullTag.replace('@', '@!');
          processedContent = processedContent.split(altTag).join(`@${existingInfo.personaName}`);
        } else {
          // Unknown user - leave the mention as-is or use placeholder
          logger.debug(
            { discordId },
            '[MentionResolver] Could not resolve mention - user not in shared server or database'
          );
          // Leave as-is: the AI will see <@123456> which is fine
        }
      }
    }

    logger.debug(
      {
        resolvedCount: mentionedUserInfos.length,
        totalMentions: processedIds.size,
      },
      '[MentionResolver] Mention resolution complete'
    );

    return {
      processedContent,
      mentionedUsers: mentionedUserInfos,
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
      logger.error(
        { err: error, discordId },
        '[MentionResolver] Failed to look up existing user'
      );
      return null;
    }
  }
}
