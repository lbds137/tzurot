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

import { MessageRole } from '@tzurot/common-types/constants/message';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  type ConversationMessage,
  type CrossChannelHistoryGroup,
} from '@tzurot/common-types/types/conversationMessage';
import { ConversationHistoryService } from '@tzurot/conversation-history';
import { getOrCreateUserService, type UserService } from '@tzurot/identity';
import type {
  ContextDataSource,
  CrossChannelHistoryParams,
  RelayEchoUserIdentity,
} from './types.js';

export class PrismaContextDataSource implements ContextDataSource {
  private readonly history: ConversationHistoryService;
  private readonly users: UserService;

  constructor(private readonly prisma: PrismaClient) {
    this.history = new ConversationHistoryService(prisma);
    this.users = getOrCreateUserService(prisma);
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

  async getUserIdentitiesByDiscordIds(
    discordIds: string[]
  ): Promise<Map<string, RelayEchoUserIdentity>> {
    if (discordIds.length === 0) {
      return new Map();
    }
    // A persisted message's `discordMessageId` is an array (a long reply can span
    // several Discord messages); `hasSome` matches any row containing one of the
    // queried ids. Scope to user rows carrying a real persona — relay-echoes were
    // saved with the human's personaId, which is exactly what we want to recover.
    const rows = await this.prisma.conversationHistory.findMany({
      where: {
        discordMessageId: { hasSome: discordIds },
        role: MessageRole.User,
      },
      select: {
        discordMessageId: true,
        personaId: true,
        persona: {
          select: {
            name: true,
            preferredName: true,
            owner: { select: { username: true } },
          },
        },
      },
      take: discordIds.length,
    });

    const queried = new Set(discordIds);
    const byDiscordId = new Map<string, RelayEchoUserIdentity>();
    for (const row of rows) {
      const identity: RelayEchoUserIdentity = {
        personaId: row.personaId,
        personaName: row.persona.preferredName ?? row.persona.name,
        discordUsername: row.persona.owner.username,
      };
      for (const id of row.discordMessageId) {
        // first row wins for a given id (findMany has no inherent ordering, but a
        // relay-echo is a single Discord message → exactly one matching row)
        if (queried.has(id) && !byDiscordId.has(id)) {
          byDiscordId.set(id, identity);
        }
      }
    }
    return byDiscordId;
  }
}
