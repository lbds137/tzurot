/**
 * MentionResolver - Resolves Discord mentions (users, channels, roles) in message content.
 */

import type { PrismaClient, PersonaResolver } from '@tzurot/common-types';
import type { Collection, User, Guild, Message } from 'discord.js';
import {
  UserService,
  createLogger,
  DISCORD_MENTIONS,
  isValidDiscordId,
} from '@tzurot/common-types';
import type {
  MentionedUserInfo,
  MentionResolutionResult,
  FullMentionResolutionResult,
  ResolvedChannel,
  ResolvedRole,
} from './MentionResolverTypes.js';

// Re-export types for consumers
export type {
  MentionedUserInfo,
  MentionResolutionResult,
  FullMentionResolutionResult,
  ResolvedChannel,
  ResolvedRole,
} from './MentionResolverTypes.js';

const logger = createLogger('MentionResolver');

/**
 * Resolves Discord user mentions to persona names
 */
export class MentionResolver {
  private userService: UserService;
  private personaResolver: PersonaResolver;

  constructor(
    private prisma: PrismaClient,
    personaResolver: PersonaResolver
  ) {
    this.userService = new UserService(prisma);
    this.personaResolver = personaResolver;
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
    // Process all users in parallel for better performance
    const userInfoMap = new Map<string, MentionedUserInfo>();

    const resolutionResults = await Promise.all(
      uniqueIds.map(async (discordId): Promise<[string, MentionedUserInfo | null]> => {
        const discordUser = mentionedUsers.get(discordId);

        if (discordUser) {
          // User is available - get or create their persona
          const userInfo = await this.resolveKnownUser(discordUser, personalityId);
          return [discordId, userInfo];
        } else {
          // User not in mentions collection - try to look up from our database
          const existingInfo = await this.lookupExistingUser(discordId, personalityId);
          if (!existingInfo) {
            logger.debug(
              { discordId },
              '[MentionResolver] Could not resolve mention - user not in shared server or database'
            );
          }
          return [discordId, existingInfo];
        }
      })
    );

    // Populate the map with successful resolutions
    for (const [discordId, userInfo] of resolutionResults) {
      if (userInfo) {
        userInfoMap.set(discordId, userInfo);
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

      // Get or create user + default persona (skip bots)
      const userId = await this.userService.getOrCreateUser(
        discordUser.id,
        discordUser.username,
        displayName,
        undefined, // bio
        discordUser.bot // isBot
      );

      // Skip bots - they don't have personas
      if (userId === null) {
        return null;
      }

      // Get persona for this user + personality combination
      // Uses PersonaResolver with proper cache invalidation via Redis pub/sub
      const personaResult = await this.personaResolver.resolve(discordUser.id, personalityId);
      const personaId = personaResult.config.personaId;
      const personaName = personaResult.config.preferredName;

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
      // Uses PersonaResolver with proper cache invalidation via Redis pub/sub
      const personaResult = await this.personaResolver.resolve(discordId, personalityId);
      const personaId = personaResult.config.personaId;
      const personaName = personaResult.config.preferredName;

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

  /**
   * Resolve all mention types in a message (users, channels, roles)
   *
   * @param content - Message content containing mentions
   * @param message - Discord message object (for guild/channel access)
   * @param personalityId - The personality ID for persona lookup
   * @returns Processed content and info about all mentioned entities
   */
  async resolveAllMentions(
    content: string,
    message: Message,
    personalityId: string
  ): Promise<FullMentionResolutionResult> {
    // Start with user mentions (existing logic)
    const userResult = await this.resolveMentions(content, message.mentions.users, personalityId);

    let processedContent = userResult.processedContent;

    // Resolve channel mentions
    const channelResult = this.resolveChannelMentions(processedContent, message.guild);
    processedContent = channelResult.processedContent;

    // Resolve role mentions
    const roleResult = this.resolveRoleMentions(processedContent, message.guild);
    processedContent = roleResult.processedContent;

    return {
      processedContent,
      mentionedUsers: userResult.mentionedUsers,
      mentionedChannels: channelResult.mentionedChannels,
      mentionedRoles: roleResult.mentionedRoles,
    };
  }

  /**
   * Resolve channel mentions in message content
   * Replaces <#channelId> with #channel-name
   *
   * @param content - Message content containing channel mentions
   * @param guild - Discord guild object (for channel lookup)
   * @returns Processed content and info about mentioned channels
   */
  resolveChannelMentions(
    content: string,
    guild: Guild | null
  ): { processedContent: string; mentionedChannels: ResolvedChannel[] } {
    const channelRegex = new RegExp(DISCORD_MENTIONS.CHANNEL_PATTERN, 'g');
    const matches = [...content.matchAll(channelRegex)];

    if (matches.length === 0) {
      return {
        processedContent: content,
        mentionedChannels: [],
      };
    }

    logger.debug(
      { mentionCount: matches.length },
      '[MentionResolver] Found channel mentions to resolve'
    );

    // Extract unique channel IDs and validate (Discord snowflakes are 17-19 digit strings)
    const allUniqueIds = [...new Set(matches.map(m => m[1]))].filter(isValidDiscordId);

    // Limit for DoS prevention
    const uniqueIds =
      allUniqueIds.length > DISCORD_MENTIONS.MAX_CHANNELS_PER_MESSAGE
        ? allUniqueIds.slice(0, DISCORD_MENTIONS.MAX_CHANNELS_PER_MESSAGE)
        : allUniqueIds;

    if (allUniqueIds.length > DISCORD_MENTIONS.MAX_CHANNELS_PER_MESSAGE) {
      logger.warn(
        {
          uniqueChannels: allUniqueIds.length,
          limit: DISCORD_MENTIONS.MAX_CHANNELS_PER_MESSAGE,
        },
        '[MentionResolver] Unique channel mentions exceed limit, processing only first batch'
      );
    }

    const mentionedChannels: ResolvedChannel[] = [];
    let processedContent = content;

    for (const channelId of uniqueIds) {
      // Try to get channel from guild cache
      const channel = guild?.channels.cache.get(channelId);

      if (channel && 'name' in channel) {
        const resolved: ResolvedChannel = {
          channelId,
          channelName: channel.name,
          guildId: guild?.id,
        };

        // Add topic if available (text channels have topics)
        if (
          'topic' in channel &&
          channel.topic !== undefined &&
          channel.topic !== null &&
          channel.topic.length > 0
        ) {
          resolved.topic = channel.topic;
        }

        mentionedChannels.push(resolved);

        // Replace mention with readable name
        const mentionTag = `<#${channelId}>`;
        processedContent = processedContent.replaceAll(mentionTag, `#${channel.name}`);
      } else {
        // Channel not found - leave as-is or use placeholder
        logger.debug(
          { channelId },
          '[MentionResolver] Could not resolve channel - not in cache or external'
        );
        // Replace with a generic placeholder to avoid raw IDs in prompt
        const mentionTag = `<#${channelId}>`;
        processedContent = processedContent.replaceAll(
          mentionTag,
          DISCORD_MENTIONS.UNKNOWN_CHANNEL_PLACEHOLDER
        );
      }
    }

    logger.debug(
      {
        resolvedCount: mentionedChannels.length,
        totalMentions: uniqueIds.length,
      },
      '[MentionResolver] Channel mention resolution complete'
    );

    return {
      processedContent,
      mentionedChannels,
    };
  }

  /**
   * Resolve role mentions in message content
   * Replaces <@&roleId> with @RoleName
   *
   * @param content - Message content containing role mentions
   * @param guild - Discord guild object (for role lookup)
   * @returns Processed content and info about mentioned roles
   */
  resolveRoleMentions(
    content: string,
    guild: Guild | null
  ): { processedContent: string; mentionedRoles: ResolvedRole[] } {
    const roleRegex = new RegExp(DISCORD_MENTIONS.ROLE_PATTERN, 'g');
    const matches = [...content.matchAll(roleRegex)];

    if (matches.length === 0) {
      return {
        processedContent: content,
        mentionedRoles: [],
      };
    }

    logger.debug(
      { mentionCount: matches.length },
      '[MentionResolver] Found role mentions to resolve'
    );

    // Extract unique role IDs and validate (Discord snowflakes are 17-19 digit strings)
    const allUniqueIds = [...new Set(matches.map(m => m[1]))].filter(isValidDiscordId);

    // Limit for DoS prevention
    const uniqueIds =
      allUniqueIds.length > DISCORD_MENTIONS.MAX_ROLES_PER_MESSAGE
        ? allUniqueIds.slice(0, DISCORD_MENTIONS.MAX_ROLES_PER_MESSAGE)
        : allUniqueIds;

    if (allUniqueIds.length > DISCORD_MENTIONS.MAX_ROLES_PER_MESSAGE) {
      logger.warn(
        {
          uniqueRoles: allUniqueIds.length,
          limit: DISCORD_MENTIONS.MAX_ROLES_PER_MESSAGE,
        },
        '[MentionResolver] Unique role mentions exceed limit, processing only first batch'
      );
    }

    const mentionedRoles: ResolvedRole[] = [];
    let processedContent = content;

    for (const roleId of uniqueIds) {
      // Try to get role from guild cache
      const role = guild?.roles.cache.get(roleId);

      if (role) {
        mentionedRoles.push({
          roleId,
          roleName: role.name,
          mentionable: role.mentionable,
        });

        // Replace mention with readable name
        const mentionTag = `<@&${roleId}>`;
        processedContent = processedContent.replaceAll(mentionTag, `@${role.name}`);
      } else {
        // Role not found - leave as-is or use placeholder
        logger.debug(
          { roleId },
          '[MentionResolver] Could not resolve role - not in cache or external'
        );
        // Replace with a generic placeholder
        const mentionTag = `<@&${roleId}>`;
        processedContent = processedContent.replaceAll(
          mentionTag,
          DISCORD_MENTIONS.UNKNOWN_ROLE_PLACEHOLDER
        );
      }
    }

    logger.debug(
      {
        resolvedCount: mentionedRoles.length,
        totalMentions: uniqueIds.length,
      },
      '[MentionResolver] Role mention resolution complete'
    );

    return {
      processedContent,
      mentionedRoles,
    };
  }
}
