/**
 * Prisma-backed ContextDataSource.
 *
 * Deliberately thin: every read delegates to the SAME shared services the
 * bot-client pipeline uses today (`ConversationHistoryService`,
 * `UserService`) so hydrated results are comparable row-for-row with the
 * bot-client-assembled payload during the shadow-verification window. The
 * context-epoch lookup replicates bot-client's raw
 * `userPersonaHistoryConfig` query (the one read that never had a service
 * wrapper).
 */

import {
  type ConversationMessage,
  type CrossChannelHistoryGroup,
  type PrismaClient,
} from '@tzurot/common-types';
import { ConversationHistoryService } from '@tzurot/conversation-history';
import { UserService } from '@tzurot/identity';
import type { ContextDataSource, CrossChannelHistoryParams } from './types.js';

export class PrismaContextDataSource implements ContextDataSource {
  private readonly history: ConversationHistoryService;
  private readonly users: UserService;

  constructor(private readonly prisma: PrismaClient) {
    this.history = new ConversationHistoryService(prisma);
    this.users = new UserService(prisma);
  }

  async getChannelHistory(
    channelId: string,
    limit: number,
    contextEpoch?: Date,
    maxAgeSeconds?: number | null
  ): Promise<ConversationMessage[]> {
    return this.history.getChannelHistory(channelId, limit, contextEpoch, maxAgeSeconds);
  }

  async getCrossChannelHistory(
    params: CrossChannelHistoryParams
  ): Promise<CrossChannelHistoryGroup[]> {
    return this.history.getCrossChannelHistory(
      params.personaId,
      params.personalityId,
      params.excludeChannelId,
      params.limit,
      { maxAgeSeconds: params.maxAgeSeconds ?? undefined, contextEpoch: params.contextEpoch }
    );
  }

  async getMessageByDiscordId(discordMessageId: string): Promise<ConversationMessage | null> {
    return this.history.getMessageByDiscordId(discordMessageId);
  }

  async findUserByDiscordId(discordId: string): Promise<{ id: string; username: string } | null> {
    return this.prisma.user.findUnique({
      where: { discordId },
      select: { id: true, username: true },
    });
  }

  async getUserTimezone(internalUserId: string): Promise<string> {
    return this.users.getUserTimezone(internalUserId);
  }

  async getContextEpoch(
    internalUserId: string,
    personalityId: string,
    personaId: string
  ): Promise<Date | undefined> {
    const historyConfig = await this.prisma.userPersonaHistoryConfig.findUnique({
      where: {
        userId_personalityId_personaId: {
          userId: internalUserId,
          personalityId,
          personaId,
        },
      },
      select: { lastContextReset: true },
    });
    return historyConfig?.lastContextReset ?? undefined;
  }

  async getPersonalityNamesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.personality.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
      take: ids.length,
    });
    return new Map(rows.map(row => [row.id, row.name]));
  }
}
