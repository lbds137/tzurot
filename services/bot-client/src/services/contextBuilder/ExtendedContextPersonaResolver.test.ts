/**
 * Extended Context Persona Resolver Tests
 *
 * Tests for resolving discord:XXXX personaIds to UUIDs
 * for both message authors and reaction reactors in a single batch.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ConversationMessage, PersonaResolver } from '@tzurot/common-types';
import { MessageRole } from '@tzurot/common-types';
import {
  collectAllDiscordIdsNeedingResolution,
  batchResolvePersonas,
  applyResolvedPersonas,
  remapParticipantGuildInfoKeys,
  resolveExtendedContextPersonaIds,
  type ParticipantGuildInfo,
} from './ExtendedContextPersonaResolver.js';

// Helper to create minimal ConversationMessage for tests
function createMessage(partial: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: partial.id ?? 'test-id',
    role: partial.role ?? MessageRole.User,
    content: partial.content ?? 'test content',
    createdAt: partial.createdAt ?? new Date(),
    personaId: partial.personaId ?? 'test-persona',
    discordMessageId: partial.discordMessageId ?? ['test-discord-id'],
    channelId: 'test-channel',
    guildId: 'test-guild',
    ...partial,
  };
}

// Helper to create mock PersonaResolver
function createMockPersonaResolver(
  resolveMap: Record<string, { personaId: string; preferredName: string | null }>
): PersonaResolver {
  return {
    resolverName: 'mock-resolver',
    resolve: vi.fn().mockImplementation(async (discordId: string) => {
      const result = resolveMap[discordId];
      if (result) {
        return { config: { personaId: result.personaId, preferredName: result.preferredName } };
      }
      return { config: { personaId: '', preferredName: null } };
    }),
    resolveForMemory: vi.fn(),
    getFocusModeStatus: vi.fn(),
    resolveFresh: vi.fn(),
    getMemoriesForPersona: vi.fn(),
    canRespondToUser: vi.fn(),
    isUserShadowBanned: vi.fn(),
    shadowBanUser: vi.fn(),
    unShadowBanUser: vi.fn(),
    listShadowBannedUsers: vi.fn(),
    getGlobalCooldownStatus: vi.fn(),
    isPersonalityDisabledInChannel: vi.fn(),
    disablePersonalityInChannel: vi.fn(),
    enablePersonalityInChannel: vi.fn(),
    listDisabledChannels: vi.fn(),
    setPersonaPreferredName: vi.fn(),
    clearCache: vi.fn(),
    clearPersonaCache: vi.fn(),
    clearShadowBanCache: vi.fn(),
    clearDisabledChannelCache: vi.fn(),
  } as unknown as PersonaResolver;
}

describe('ExtendedContextPersonaResolver', () => {
  describe('collectAllDiscordIdsNeedingResolution', () => {
    it('should collect discordIds from message authors', () => {
      const messages: ConversationMessage[] = [
        createMessage({ role: MessageRole.User, content: 'Hello', personaId: 'discord:123' }),
        createMessage({ role: MessageRole.User, content: 'World', personaId: 'discord:456' }),
        createMessage({ role: MessageRole.Assistant, content: 'Hi', personaId: 'uuid-bot' }),
      ];
      const userMap = new Map([
        ['123', 'user-id-123'],
        ['456', 'user-id-456'],
      ]);

      const result = collectAllDiscordIdsNeedingResolution(messages, userMap);

      expect(result.size).toBe(2);
      expect(result.has('123')).toBe(true);
      expect(result.has('456')).toBe(true);
    });

    it('should collect discordIds from reaction reactors', () => {
      const messages: ConversationMessage[] = [
        createMessage({
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'already-uuid', // Not a discord: prefix
          messageMetadata: {
            reactions: [
              {
                emoji: '👍',
                reactors: [
                  { personaId: 'discord:111', displayName: 'User1' },
                  { personaId: 'discord:222', displayName: 'User2' },
                ],
              },
            ],
          },
        }),
      ];
      const userMap = new Map([
        ['111', 'user-id-111'],
        ['222', 'user-id-222'],
      ]);

      const result = collectAllDiscordIdsNeedingResolution(messages, userMap);

      expect(result.size).toBe(2);
      expect(result.has('111')).toBe(true);
      expect(result.has('222')).toBe(true);
    });

    it('should collect BOTH message authors AND reactors', () => {
      const messages: ConversationMessage[] = [
        createMessage({
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'discord:123',
          messageMetadata: {
            reactions: [
              {
                emoji: '👍',
                reactors: [{ personaId: 'discord:456', displayName: 'Reactor' }],
              },
            ],
          },
        }),
      ];
      const userMap = new Map([
        ['123', 'user-id-123'],
        ['456', 'user-id-456'],
      ]);

      const result = collectAllDiscordIdsNeedingResolution(messages, userMap);

      expect(result.size).toBe(2);
      expect(result.has('123')).toBe(true);
      expect(result.has('456')).toBe(true);
    });

    it('should dedupe when same user is author AND reactor', () => {
      const messages: ConversationMessage[] = [
        createMessage({
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'discord:123',
          messageMetadata: {
            reactions: [
              {
                emoji: '👍',
                reactors: [{ personaId: 'discord:123', displayName: 'SameUser' }],
              },
            ],
          },
        }),
      ];
      const userMap = new Map([['123', 'user-id-123']]);

      const result = collectAllDiscordIdsNeedingResolution(messages, userMap);

      expect(result.size).toBe(1);
      expect(result.has('123')).toBe(true);
    });

    it('should skip IDs not in userMap', () => {
      const messages: ConversationMessage[] = [
        createMessage({ role: MessageRole.User, content: 'Hello', personaId: 'discord:123' }),
        createMessage({ role: MessageRole.User, content: 'World', personaId: 'discord:999' }),
      ];
      const userMap = new Map([['123', 'user-id-123']]);

      const result = collectAllDiscordIdsNeedingResolution(messages, userMap);

      expect(result.size).toBe(1);
      expect(result.has('123')).toBe(true);
      expect(result.has('999')).toBe(false);
    });
  });

  describe('batchResolvePersonas', () => {
    it('should resolve personas for all discordIds', async () => {
      const discordIds = new Set(['123', '456']);
      const personaResolver = createMockPersonaResolver({
        '123': { personaId: 'uuid-alice', preferredName: 'Alice' },
        '456': { personaId: 'uuid-bob', preferredName: 'Bob' },
      });

      const result = await batchResolvePersonas(discordIds, 'personality-1', personaResolver);

      expect(result.size).toBe(2);
      expect(result.get('123')).toEqual({ personaId: 'uuid-alice', preferredName: 'Alice' });
      expect(result.get('456')).toEqual({ personaId: 'uuid-bob', preferredName: 'Bob' });
    });

    it('should skip unresolvable personas', async () => {
      const discordIds = new Set(['123', '999']);
      const personaResolver = createMockPersonaResolver({
        '123': { personaId: 'uuid-alice', preferredName: 'Alice' },
      });

      const result = await batchResolvePersonas(discordIds, 'personality-1', personaResolver);

      expect(result.size).toBe(1);
      expect(result.get('123')).toEqual({ personaId: 'uuid-alice', preferredName: 'Alice' });
      expect(result.has('999')).toBe(false);
    });
  });

  describe('applyResolvedPersonas', () => {
    it('should update BOTH message authors AND reactors', () => {
      const messages: ConversationMessage[] = [
        createMessage({
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'discord:123',
          personaName: 'OldName',
          messageMetadata: {
            reactions: [
              {
                emoji: '👍',
                reactors: [{ personaId: 'discord:456', displayName: 'OldReactorName' }],
              },
            ],
          },
        }),
      ];
      const resolvedMap = new Map([
        ['123', { personaId: 'uuid-alice', preferredName: 'Alice' }],
        ['456', { personaId: 'uuid-bob', preferredName: 'Bob' }],
      ]);

      const { messageCount, reactorCount, guildInfoRemap } = applyResolvedPersonas(
        messages,
        resolvedMap
      );

      expect(messageCount).toBe(1);
      expect(reactorCount).toBe(1);
      expect(messages[0].personaId).toBe('uuid-alice');
      expect(messages[0].personaName).toBe('Alice');
      expect(messages[0].messageMetadata?.reactions?.[0].reactors[0].personaId).toBe('uuid-bob');
      expect(messages[0].messageMetadata?.reactions?.[0].reactors[0].displayName).toBe('Bob');
      expect(guildInfoRemap.size).toBe(1);
    });

    it('should preserve names when preferredName is null', () => {
      const messages: ConversationMessage[] = [
        createMessage({
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'discord:123',
          personaName: 'OriginalName',
          messageMetadata: {
            reactions: [
              {
                emoji: '👍',
                reactors: [{ personaId: 'discord:456', displayName: 'OriginalReactorName' }],
              },
            ],
          },
        }),
      ];
      const resolvedMap = new Map([
        ['123', { personaId: 'uuid-alice', preferredName: null }],
        ['456', { personaId: 'uuid-bob', preferredName: null }],
      ]);

      applyResolvedPersonas(messages, resolvedMap);

      expect(messages[0].personaId).toBe('uuid-alice');
      expect(messages[0].personaName).toBe('OriginalName'); // Preserved
      expect(messages[0].messageMetadata?.reactions?.[0].reactors[0].personaId).toBe('uuid-bob');
      expect(messages[0].messageMetadata?.reactions?.[0].reactors[0].displayName).toBe(
        'OriginalReactorName'
      ); // Preserved
    });

    it('should skip already-resolved IDs', () => {
      const messages: ConversationMessage[] = [
        createMessage({
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'already-uuid', // Not discord: prefix
          messageMetadata: {
            reactions: [
              {
                emoji: '👍',
                reactors: [{ personaId: 'also-already-uuid', displayName: 'User' }],
              },
            ],
          },
        }),
      ];
      const resolvedMap = new Map([['123', { personaId: 'uuid-alice', preferredName: 'Alice' }]]);

      const { messageCount, reactorCount } = applyResolvedPersonas(messages, resolvedMap);

      expect(messageCount).toBe(0);
      expect(reactorCount).toBe(0);
    });
  });

  describe('remapParticipantGuildInfoKeys', () => {
    it('should remap keys from discord:XXX to resolved UUIDs', () => {
      const participantGuildInfo: ParticipantGuildInfo = {
        'discord:123': { roles: ['Admin'], displayColor: '#ff0000' },
        'discord:456': { roles: ['Member'] },
      };
      const guildInfoRemap = new Map([
        ['discord:123', 'uuid-alice'],
        ['discord:456', 'uuid-bob'],
      ]);

      remapParticipantGuildInfoKeys(participantGuildInfo, guildInfoRemap);

      expect(participantGuildInfo['uuid-alice']).toEqual({
        roles: ['Admin'],
        displayColor: '#ff0000',
      });
      expect(participantGuildInfo['uuid-bob']).toEqual({ roles: ['Member'] });
      expect(participantGuildInfo['discord:123']).toBeUndefined();
      expect(participantGuildInfo['discord:456']).toBeUndefined();
    });
  });

  describe('resolveExtendedContextPersonaIds (unified)', () => {
    it('should resolve BOTH message authors AND reactors in one batch', async () => {
      const messages: ConversationMessage[] = [
        createMessage({
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'discord:123',
          messageMetadata: {
            reactions: [
              {
                emoji: '👍',
                reactors: [{ personaId: 'discord:456', displayName: 'User456' }],
              },
            ],
          },
        }),
      ];
      const userMap = new Map([
        ['123', 'user-id-123'],
        ['456', 'user-id-456'],
      ]);
      const personaResolver = createMockPersonaResolver({
        '123': { personaId: 'uuid-alice', preferredName: 'Alice' },
        '456': { personaId: 'uuid-bob', preferredName: 'Bob' },
      });

      const result = await resolveExtendedContextPersonaIds(
        messages,
        userMap,
        'personality-1',
        personaResolver
      );

      expect(result.messageCount).toBe(1);
      expect(result.reactorCount).toBe(1);
      expect(result.total).toBe(2);

      // Verify message author resolved
      expect(messages[0].personaId).toBe('uuid-alice');
      expect(messages[0].personaName).toBe('Alice');

      // Verify reactor resolved
      expect(messages[0].messageMetadata?.reactions?.[0].reactors[0].personaId).toBe('uuid-bob');
      expect(messages[0].messageMetadata?.reactions?.[0].reactors[0].displayName).toBe('Bob');
    });

    it('should remap guild info keys', async () => {
      const messages: ConversationMessage[] = [
        createMessage({ role: MessageRole.User, content: 'Hello', personaId: 'discord:123' }),
      ];
      const userMap = new Map([['123', 'user-id-123']]);
      const participantGuildInfo: ParticipantGuildInfo = {
        'discord:123': { roles: ['Admin'] },
      };
      const personaResolver = createMockPersonaResolver({
        '123': { personaId: 'uuid-alice', preferredName: 'Alice' },
      });

      await resolveExtendedContextPersonaIds(
        messages,
        userMap,
        'personality-1',
        personaResolver,
        participantGuildInfo
      );

      expect(participantGuildInfo['uuid-alice']).toEqual({ roles: ['Admin'] });
      expect(participantGuildInfo['discord:123']).toBeUndefined();
    });

    it('should strip unresolved discord: placeholders when userMap is empty', async () => {
      // Post-Phase-4 contract: the strip pass runs unconditionally. An empty
      // userMap means zero users got provisioned — every discord: placeholder
      // is unresolvable and must be stripped to '' so ai-worker never sees
      // the format. messageCount/reactorCount count resolved entries (zero
      // here), while strippedMessageCount captures the stripped tail.
      const messages: ConversationMessage[] = [
        createMessage({ role: MessageRole.User, content: 'Hello', personaId: 'discord:123' }),
      ];
      const personaResolver = createMockPersonaResolver({});

      const result = await resolveExtendedContextPersonaIds(
        messages,
        new Map(),
        'personality-1',
        personaResolver
      );

      expect(result.messageCount).toBe(0);
      expect(result.reactorCount).toBe(0);
      expect(result.total).toBe(0);
      expect(result.strippedMessageCount).toBe(1);
      expect(messages[0].personaId).toBe(''); // Stripped — unresolvable
    });

    it('should strip discord: placeholders for users in userMap but without a persona', async () => {
      // Mixed case: one user IS in userMap and resolves to a UUID; another
      // is ALSO in userMap (provisioning succeeded as a shell user) but has
      // no owned persona, so the resolver returns an empty personaId → the
      // message gets stripped. Also exercises a reactor in the same state.
      const messages: ConversationMessage[] = [
        createMessage({
          role: MessageRole.User,
          content: 'Hello from Alice',
          personaId: 'discord:111',
        }),
        createMessage({
          role: MessageRole.User,
          content: 'Hello from the ghost',
          personaId: 'discord:222',
          messageMetadata: {
            reactions: [
              {
                emoji: '👋',
                reactors: [
                  { personaId: 'discord:111', displayName: 'Alice' },
                  { personaId: 'discord:222', displayName: 'Ghost' },
                ],
              },
            ],
          },
        }),
      ];
      const userMap = new Map([
        ['111', 'user-111'],
        ['222', 'user-222'],
      ]);
      const personaResolver = createMockPersonaResolver({
        '111': { personaId: 'uuid-alice', preferredName: 'Alice' },
        // '222' intentionally omitted — returns empty personaId
      });

      const result = await resolveExtendedContextPersonaIds(
        messages,
        userMap,
        'personality-1',
        personaResolver
      );

      // Alice's message resolves
      expect(messages[0].personaId).toBe('uuid-alice');
      // Ghost's message is stripped (unresolvable) — empty-string sentinel
      expect(messages[1].personaId).toBe('');

      // Reactor for Alice resolves; Ghost reactor is dropped
      const reactors = messages[1].messageMetadata?.reactions?.[0].reactors ?? [];
      expect(reactors).toHaveLength(1);
      expect(reactors[0].personaId).toBe('uuid-alice');

      // Stats reflect the split
      expect(result.messageCount).toBe(1); // Alice resolved
      expect(result.strippedMessageCount).toBe(1); // Ghost stripped
      expect(result.reactorCount).toBe(1); // Alice reactor resolved
      expect(result.strippedReactorCount).toBe(1); // Ghost reactor dropped
    });

    it('should return zeros when no discord: IDs exist', async () => {
      const messages: ConversationMessage[] = [
        createMessage({ role: MessageRole.User, content: 'Hello', personaId: 'already-uuid' }),
      ];
      const userMap = new Map([['123', 'user-id-123']]);
      const personaResolver = createMockPersonaResolver({
        '123': { personaId: 'uuid-alice', preferredName: 'Alice' },
      });

      const result = await resolveExtendedContextPersonaIds(
        messages,
        userMap,
        'personality-1',
        personaResolver
      );

      expect(result.total).toBe(0);
    });

    it('should only call batchResolvePersonas ONCE for shared IDs', async () => {
      // Same user is both message author and reactor
      const messages: ConversationMessage[] = [
        createMessage({
          role: MessageRole.User,
          content: 'Hello',
          personaId: 'discord:123',
          messageMetadata: {
            reactions: [
              {
                emoji: '👍',
                reactors: [{ personaId: 'discord:123', displayName: 'SameUser' }],
              },
            ],
          },
        }),
      ];
      const userMap = new Map([['123', 'user-id-123']]);
      const personaResolver = createMockPersonaResolver({
        '123': { personaId: 'uuid-alice', preferredName: 'Alice' },
      });

      const result = await resolveExtendedContextPersonaIds(
        messages,
        userMap,
        'personality-1',
        personaResolver
      );

      // Should resolve both author and reactor
      expect(result.messageCount).toBe(1);
      expect(result.reactorCount).toBe(1);
      expect(result.total).toBe(2);

      // Should only call resolve ONCE (deduped)
      expect(personaResolver.resolve).toHaveBeenCalledTimes(1);
    });
  });
});
