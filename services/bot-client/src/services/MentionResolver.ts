/**
 * MentionResolver - Resolves Discord mentions (users, channels, roles) in message content.
 *
 * Thin Discord adapter over the shared mention-rewriting kernels in
 * common-types (`resolveUserMentions` / `rewriteChannelMentions` /
 * `rewriteRoleMentions`) — the scan/dedup/cap/placeholder rules live there
 * so ai-worker's content rewriter cannot drift from this path. This class
 * owns only the Discord-side lookups: the live mentions collection, the
 * guild cache, and the bot's DB fallback.
 */

import {
  type PrismaClient,
  type PersonaResolver,
  type MentionTargetUser,
  type RawMentionedChannel,
  type RawMentionedRole,
  UserService,
  resolveUserMentions,
  rewriteChannelMentions,
  rewriteRoleMentions,
} from '@tzurot/common-types';
import type { Collection, User, Guild, Message } from 'discord.js';
import type {
  MentionResolutionResult,
  FullMentionResolutionResult,
  ResolvedChannel,
  ResolvedRole,
} from './MentionResolverTypes.js';

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
    // Adapt the live Discord collection to the kernel's plain target map —
    // the SAME displayName derivation the raw envelope uses, so worker-side
    // resolution from rawMentionedUsers starts from identical inputs.
    const targets = new Map<string, MentionTargetUser>(
      [...mentionedUsers.values()].map(u => [
        u.id,
        {
          discordId: u.id,
          username: u.username,
          displayName: u.globalName ?? u.username,
          isBot: u.bot,
        },
      ])
    );

    return resolveUserMentions(content, targets, personalityId, {
      getOrCreateUser: (discordId, username, displayName, bio, isBot) =>
        this.userService.getOrCreateUser(discordId, username, displayName, bio, isBot),
      resolvePersona: async (discordUserId, pid) => {
        const result = await this.personaResolver.resolve(discordUserId, pid);
        return {
          personaId: result.config.personaId,
          preferredName: result.config.preferredName,
        };
      },
      findUserByDiscordId: discordId =>
        this.prisma.user.findUnique({
          where: { discordId },
          select: { id: true, username: true },
        }),
    });
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
    return rewriteChannelMentions(content, (channelId): RawMentionedChannel | null => {
      const channel = guild?.channels.cache.get(channelId);
      if (channel === undefined || !('name' in channel)) {
        return null;
      }
      const resolved: RawMentionedChannel = {
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
      return resolved;
    });
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
    return rewriteRoleMentions(content, (roleId): RawMentionedRole | null => {
      const role = guild?.roles.cache.get(roleId);
      if (role === undefined) {
        return null;
      }
      return {
        roleId,
        roleName: role.name,
        mentionable: role.mentionable,
      };
    });
  }
}
