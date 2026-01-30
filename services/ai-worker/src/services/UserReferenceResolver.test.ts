import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserReferenceResolver } from './UserReferenceResolver.js';
import type { PrismaClient } from '@tzurot/common-types';

// Mock the logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  };
});

describe('UserReferenceResolver', () => {
  let resolver: UserReferenceResolver;
  let mockPrisma: {
    shapesPersonaMapping: {
      findMany: ReturnType<typeof vi.fn>;
    };
    user: {
      findMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      shapesPersonaMapping: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    resolver = new UserReferenceResolver(mockPrisma as unknown as PrismaClient);
  });

  describe('resolveUserReferences', () => {
    describe('shapes.inc markdown format: @[username](user:uuid)', () => {
      it('should resolve shapes.inc user reference to persona name', async () => {
        const shapesUserId = '98a94b95-cbd0-430b-8be2-602e1c75d8b0';
        const text = `Hello @[lbds137](user:${shapesUserId}), how are you?`;

        mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([
          {
            shapesUserId,
            persona: {
              id: 'persona-uuid',
              name: 'lbds137',
              preferredName: 'Lila',
              pronouns: 'she/her',
              content: 'A magical being',
            },
          },
        ]);

        const result = await resolver.resolveUserReferences(text);

        expect(result.processedText).toBe('Hello Lila, how are you?');
        expect(result.resolvedPersonas).toHaveLength(1);
        expect(result.resolvedPersonas[0]).toEqual({
          personaId: 'persona-uuid',
          personaName: 'Lila',
          preferredName: 'Lila',
          pronouns: 'she/her',
          content: 'A magical being',
        });
        expect(mockPrisma.shapesPersonaMapping.findMany).toHaveBeenCalledWith({
          where: { shapesUserId: { in: [shapesUserId] } },
          include: {
            persona: {
              select: {
                id: true,
                name: true,
                preferredName: true,
                pronouns: true,
                content: true,
              },
            },
          },
          take: 1,
        });
      });

      it('should handle multiple shapes.inc references', async () => {
        const uuid1 = '11111111-1111-1111-1111-111111111111';
        const uuid2 = '22222222-2222-2222-2222-222222222222';
        const text = `@[user1](user:${uuid1}) and @[user2](user:${uuid2}) are here`;

        mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([
          {
            shapesUserId: uuid1,
            persona: {
              id: 'persona-1',
              name: 'user1',
              preferredName: 'Alice',
              pronouns: null,
              content: 'First user',
            },
          },
          {
            shapesUserId: uuid2,
            persona: {
              id: 'persona-2',
              name: 'user2',
              preferredName: 'Bob',
              pronouns: null,
              content: 'Second user',
            },
          },
        ]);

        const result = await resolver.resolveUserReferences(text);

        expect(result.processedText).toBe('Alice and Bob are here');
        expect(result.resolvedPersonas).toHaveLength(2);
      });

      it('should fall back to name if preferredName is not set', async () => {
        const shapesUserId = '98a94b95-cbd0-430b-8be2-602e1c75d8b0';
        const text = `Hello @[username](user:${shapesUserId})`;

        mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([
          {
            shapesUserId,
            persona: {
              id: 'persona-uuid',
              name: 'fallback_name',
              preferredName: null,
              pronouns: null,
              content: 'Some content',
            },
          },
        ]);

        const result = await resolver.resolveUserReferences(text);

        expect(result.processedText).toBe('Hello fallback_name');
        expect(result.resolvedPersonas[0].personaName).toBe('fallback_name');
      });

      it('should fallback to username if mapping not found', async () => {
        const text = '@[unknown](user:00000000-0000-0000-0000-000000000000)';

        mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([]);

        const result = await resolver.resolveUserReferences(text);

        // Should fallback to the username from the reference
        expect(result.processedText).toBe('unknown');
        expect(result.resolvedPersonas).toHaveLength(0);
      });

      it('should fallback multiple unresolved references to their usernames', async () => {
        const text =
          '@[alice](user:11111111-1111-1111-1111-111111111111) and @[bob](user:22222222-2222-2222-2222-222222222222)';

        mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([]);

        const result = await resolver.resolveUserReferences(text);

        // Should fallback to usernames
        expect(result.processedText).toBe('alice and bob');
        expect(result.resolvedPersonas).toHaveLength(0);
      });
    });

    describe('Discord mention format: <@discord_id>', () => {
      it('should resolve Discord mention to persona name', async () => {
        const discordId = '278863839632818186';
        const text = `Hey <@${discordId}>, welcome!`;

        mockPrisma.user.findMany.mockResolvedValue([
          {
            discordId,
            defaultPersona: {
              id: 'persona-uuid',
              name: 'lbds137',
              preferredName: 'Lila',
              pronouns: 'she/her',
              content: 'User persona',
            },
          },
        ]);

        const result = await resolver.resolveUserReferences(text);

        expect(result.processedText).toBe('Hey Lila, welcome!');
        expect(result.resolvedPersonas).toHaveLength(1);
        expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
          where: { discordId: { in: [discordId] } },
          include: {
            defaultPersona: {
              select: {
                id: true,
                name: true,
                preferredName: true,
                pronouns: true,
                content: true,
              },
            },
          },
          take: 1,
        });
      });

      it('should handle Discord mention with ! (nickname format)', async () => {
        const text = 'Hello <@!123456789012345678>';

        mockPrisma.user.findMany.mockResolvedValue([
          {
            discordId: '123456789012345678',
            defaultPersona: {
              id: 'persona-uuid',
              name: 'testuser',
              preferredName: 'Test User',
              pronouns: null,
              content: '',
            },
          },
        ]);

        const result = await resolver.resolveUserReferences(text);

        expect(result.processedText).toBe('Hello Test User');
      });

      it('should keep original text if user not found', async () => {
        const text = '<@999999999999999999>';

        mockPrisma.user.findMany.mockResolvedValue([]);

        const result = await resolver.resolveUserReferences(text);

        expect(result.processedText).toBe(text);
        expect(result.resolvedPersonas).toHaveLength(0);
      });
    });

    describe('simple username format: @username', () => {
      it('should resolve simple username mention to persona name', async () => {
        const text = 'Hello @lbds137, how are you today?';

        // For username lookup, findMany is called with OR conditions
        mockPrisma.user.findMany.mockResolvedValue([
          {
            username: 'lbds137',
            defaultPersona: {
              id: 'persona-uuid',
              name: 'lbds137',
              preferredName: 'Lila',
              pronouns: 'she/her',
              content: 'User bio',
            },
          },
        ]);

        const result = await resolver.resolveUserReferences(text);

        expect(result.processedText).toBe('Hello Lila, how are you today?');
        expect(result.resolvedPersonas).toHaveLength(1);
        // Username batch query uses OR conditions with case-insensitive matching
        expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
          where: {
            OR: [{ username: { equals: 'lbds137', mode: 'insensitive' } }],
          },
          include: {
            defaultPersona: {
              select: {
                id: true,
                name: true,
                preferredName: true,
                pronouns: true,
                content: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
          take: 2, // usernames.length * 2
        });
      });

      it('should not match shapes.inc format as simple username', async () => {
        const text = '@[username](user:12345678-1234-1234-1234-123456789012)';

        mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([]);

        const result = await resolver.resolveUserReferences(text);

        // Shapes format is matched, no Discord IDs or usernames found
        // Batch methods return early for empty arrays, so user.findMany not called
        expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
        // The fallback to username should be applied
        expect(result.processedText).toBe('username');
      });

      it('should not match Discord format as simple username', async () => {
        const text = '<@123456789012345678>';

        mockPrisma.user.findMany.mockResolvedValue([]);

        const result = await resolver.resolveUserReferences(text);

        // Should have Discord batch query (no usernames found, so only 1 call)
        expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
        // One call for Discord IDs
        expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { discordId: { in: ['123456789012345678'] } },
          })
        );
      });
    });

    describe('deduplication', () => {
      it('should not add duplicate personas for same user referenced multiple times', async () => {
        const shapesUserId = '98a94b95-cbd0-430b-8be2-602e1c75d8b0';
        const text = `@[lbds137](user:${shapesUserId}) said hello. Later, @[lbds137](user:${shapesUserId}) left.`;

        mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([
          {
            shapesUserId,
            persona: {
              id: 'persona-uuid',
              name: 'lbds137',
              preferredName: 'Lila',
              pronouns: null,
              content: 'User content',
            },
          },
        ]);

        const result = await resolver.resolveUserReferences(text);

        expect(result.processedText).toBe('Lila said hello. Later, Lila left.');
        // Should only have one persona despite two references
        expect(result.resolvedPersonas).toHaveLength(1);
      });

      it('should deduplicate across different reference formats for same user', async () => {
        const discordId = '278863839632818186';
        const shapesUserId = '98a94b95-cbd0-430b-8be2-602e1c75d8b0';
        const text = `@[lbds137](user:${shapesUserId}) and <@${discordId}> are the same`;

        // Both references resolve to the same persona
        mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([
          {
            shapesUserId,
            persona: {
              id: 'same-persona-uuid',
              name: 'lbds137',
              preferredName: 'Lila',
              pronouns: null,
              content: 'User content',
            },
          },
        ]);

        mockPrisma.user.findMany.mockResolvedValue([
          {
            discordId,
            defaultPersona: {
              id: 'same-persona-uuid',
              name: 'lbds137',
              preferredName: 'Lila',
              pronouns: null,
              content: 'User content',
            },
          },
        ]);

        const result = await resolver.resolveUserReferences(text);

        expect(result.processedText).toBe('Lila and Lila are the same');
        // Should only have one persona despite two references
        expect(result.resolvedPersonas).toHaveLength(1);
      });
    });

    describe('mixed formats', () => {
      it('should handle all three formats in one text', async () => {
        const text =
          '@[shapes_user](user:11111111-1111-1111-1111-111111111111) met <@222222222222222222> and @simple_user';

        mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([
          {
            shapesUserId: '11111111-1111-1111-1111-111111111111',
            persona: {
              id: 'persona-1',
              name: 'shapes_user',
              preferredName: 'Alice',
              pronouns: null,
              content: 'Shapes user',
            },
          },
        ]);

        // user.findMany is called twice: once for Discord IDs, once for usernames
        mockPrisma.user.findMany
          .mockResolvedValueOnce([
            {
              discordId: '222222222222222222',
              defaultPersona: {
                id: 'persona-2',
                name: 'discord_user',
                preferredName: 'Bob',
                pronouns: null,
                content: 'Discord user',
              },
            },
          ])
          .mockResolvedValueOnce([
            {
              username: 'simple_user',
              defaultPersona: {
                id: 'persona-3',
                name: 'simple_user',
                preferredName: 'Charlie',
                pronouns: null,
                content: 'Simple user',
              },
            },
          ]);

        const result = await resolver.resolveUserReferences(text);

        expect(result.processedText).toBe('Alice met Bob and Charlie');
        expect(result.resolvedPersonas).toHaveLength(3);
      });
    });

    describe('no references', () => {
      it('should return unchanged text when no user references exist', async () => {
        const text = 'This is a normal message without any user references.';

        const result = await resolver.resolveUserReferences(text);

        expect(result.processedText).toBe(text);
        expect(result.resolvedPersonas).toHaveLength(0);
        // No DB calls because early exit (no @ or <@)
        expect(mockPrisma.shapesPersonaMapping.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      });
    });

    describe('empty text handling', () => {
      it('should return empty result for empty string', async () => {
        const result = await resolver.resolveUserReferences('');

        expect(result.processedText).toBe('');
        expect(result.resolvedPersonas).toHaveLength(0);
        // No DB calls should be made for empty text
        expect(mockPrisma.shapesPersonaMapping.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      });

      it('should return empty result for undefined-like values', async () => {
        // Test with null cast to string (edge case)
        const result = await resolver.resolveUserReferences(null as unknown as string);

        expect(result.processedText).toBe('');
        expect(result.resolvedPersonas).toHaveLength(0);
      });
    });

    describe('error handling', () => {
      it('should handle database errors gracefully by falling back to username', async () => {
        const text = '@[user](user:11111111-1111-1111-1111-111111111111)';

        mockPrisma.shapesPersonaMapping.findMany.mockRejectedValue(new Error('DB error'));

        const result = await resolver.resolveUserReferences(text);

        // Should fallback to username on error (batch resolve returns empty map on error)
        expect(result.processedText).toBe('user');
        expect(result.resolvedPersonas).toHaveLength(0);
      });
    });

    describe('self-reference handling', () => {
      it('should replace self-reference but not add to participants list', async () => {
        const shapesUserId = '98a94b95-cbd0-430b-8be2-602e1c75d8b0';
        const selfPersonaId = 'self-persona-uuid';
        const text = `I am @[myself](user:${shapesUserId}) and I love talking about myself.`;

        mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([
          {
            shapesUserId,
            persona: {
              id: selfPersonaId,
              name: 'myself',
              preferredName: 'Lilith',
              pronouns: null,
              content: 'A magical being',
            },
          },
        ]);

        // Pass activePersonaId matching the resolved persona
        const result = await resolver.resolveUserReferences(text, selfPersonaId);

        // Text should still be replaced
        expect(result.processedText).toBe('I am Lilith and I love talking about myself.');
        // But persona should NOT be added to resolvedPersonas
        expect(result.resolvedPersonas).toHaveLength(0);
      });

      it('should add non-self references but skip self-references', async () => {
        const selfUuid = '11111111-1111-1111-1111-111111111111';
        const otherUuid = '22222222-2222-2222-2222-222222222222';
        const selfPersonaId = 'self-persona-uuid';
        const text = `@[myself](user:${selfUuid}) and @[friend](user:${otherUuid}) are chatting`;

        mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([
          {
            shapesUserId: selfUuid,
            persona: {
              id: selfPersonaId,
              name: 'myself',
              preferredName: 'Lilith',
              pronouns: null,
              content: 'Self content',
            },
          },
          {
            shapesUserId: otherUuid,
            persona: {
              id: 'friend-persona-uuid',
              name: 'friend',
              preferredName: 'Alice',
              pronouns: null,
              content: 'Friend content',
            },
          },
        ]);

        const result = await resolver.resolveUserReferences(text, selfPersonaId);

        // Both should be replaced
        expect(result.processedText).toBe('Lilith and Alice are chatting');
        // Only friend should be in resolvedPersonas (self is excluded)
        expect(result.resolvedPersonas).toHaveLength(1);
        expect(result.resolvedPersonas[0].personaId).toBe('friend-persona-uuid');
        expect(result.resolvedPersonas[0].personaName).toBe('Alice');
      });

      it('should handle self-reference via Discord mention', async () => {
        const discordId = '278863839632818186';
        const selfPersonaId = 'self-persona-uuid';
        const text = `I can be mentioned as <@${discordId}> in Discord`;

        mockPrisma.user.findMany.mockResolvedValue([
          {
            discordId,
            defaultPersona: {
              id: selfPersonaId,
              name: 'myself',
              preferredName: 'Lilith',
              pronouns: null,
              content: 'Self content',
            },
          },
        ]);

        const result = await resolver.resolveUserReferences(text, selfPersonaId);

        expect(result.processedText).toBe('I can be mentioned as Lilith in Discord');
        expect(result.resolvedPersonas).toHaveLength(0);
      });

      it('should handle self-reference via simple username', async () => {
        const selfPersonaId = 'self-persona-uuid';
        const text = 'You can call me @lilith anytime';

        // For username lookup - no Discord IDs or shapes IDs, so only username batch is called
        // The batch method skips empty arrays, so only 1 call to user.findMany
        mockPrisma.user.findMany.mockResolvedValue([
          {
            username: 'lilith',
            defaultPersona: {
              id: selfPersonaId,
              name: 'lilith',
              preferredName: 'Lilith',
              pronouns: null,
              content: 'Self content',
            },
          },
        ]);

        const result = await resolver.resolveUserReferences(text, selfPersonaId);

        expect(result.processedText).toBe('You can call me Lilith anytime');
        expect(result.resolvedPersonas).toHaveLength(0);
      });

      it('should work normally when no activePersonaId is provided', async () => {
        const shapesUserId = '98a94b95-cbd0-430b-8be2-602e1c75d8b0';
        const text = `Hello @[user](user:${shapesUserId})`;

        mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([
          {
            shapesUserId,
            persona: {
              id: 'persona-uuid',
              name: 'user',
              preferredName: 'Alice',
              pronouns: null,
              content: 'User content',
            },
          },
        ]);

        // No activePersonaId - should add to participants as usual
        const result = await resolver.resolveUserReferences(text);

        expect(result.processedText).toBe('Hello Alice');
        expect(result.resolvedPersonas).toHaveLength(1);
      });
    });
  });

  describe('resolvePersonalityReferences', () => {
    const createMockPersonality = (overrides = {}) => ({
      id: 'personality-id',
      name: 'Test Personality',
      displayName: 'Test',
      slug: 'test',
      systemPrompt: '',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1000,
      contextWindowTokens: 8000,
      characterInfo: '',
      personalityTraits: '',
      ...overrides,
    });

    it('should resolve user references across multiple personality fields', async () => {
      const shapesUserId = '98a94b95-cbd0-430b-8be2-602e1c75d8b0';
      const personality = createMockPersonality({
        systemPrompt: `You are talking to @[lbds137](user:${shapesUserId})`,
        characterInfo: `This character knows @[lbds137](user:${shapesUserId}) well.`,
        conversationalExamples: `Example: @[lbds137](user:${shapesUserId}) said hello.`,
      });

      mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([
        {
          shapesUserId,
          persona: {
            id: 'persona-uuid',
            name: 'lbds137',
            preferredName: 'Lila',
            pronouns: 'she/her',
            content: 'A magical being',
          },
        },
      ]);

      const result = await resolver.resolvePersonalityReferences(personality);

      // All fields should be resolved
      expect(result.resolvedPersonality.systemPrompt).toBe('You are talking to Lila');
      expect(result.resolvedPersonality.characterInfo).toBe('This character knows Lila well.');
      expect(result.resolvedPersonality.conversationalExamples).toBe('Example: Lila said hello.');

      // Personas should be deduplicated
      expect(result.resolvedPersonas).toHaveLength(1);
      expect(result.resolvedPersonas[0].personaId).toBe('persona-uuid');
      expect(result.resolvedPersonas[0].personaName).toBe('Lila');
    });

    it('should deduplicate personas found across different fields', async () => {
      const uuid1 = '11111111-1111-1111-1111-111111111111';
      const uuid2 = '22222222-2222-2222-2222-222222222222';
      const personality = createMockPersonality({
        systemPrompt: `@[user1](user:${uuid1})`,
        characterInfo: `@[user1](user:${uuid1}) and @[user2](user:${uuid2})`,
      });

      mockPrisma.shapesPersonaMapping.findMany.mockImplementation(
        async ({ where }: { where: { shapesUserId: { in: string[] } } }) => {
          const results = [];
          for (const id of where.shapesUserId.in) {
            if (id === uuid1) {
              results.push({
                shapesUserId: uuid1,
                persona: {
                  id: 'persona-1',
                  name: 'user1',
                  preferredName: 'Alice',
                  pronouns: null,
                  content: 'Alice content',
                },
              });
            }
            if (id === uuid2) {
              results.push({
                shapesUserId: uuid2,
                persona: {
                  id: 'persona-2',
                  name: 'user2',
                  preferredName: 'Bob',
                  pronouns: null,
                  content: 'Bob content',
                },
              });
            }
          }
          return results;
        }
      );

      const result = await resolver.resolvePersonalityReferences(personality);

      // Should have exactly 2 unique personas, not 3
      expect(result.resolvedPersonas).toHaveLength(2);
      expect(result.resolvedPersonas.map(p => p.personaName).sort()).toEqual(['Alice', 'Bob']);
    });

    it('should not mutate the original personality object', async () => {
      const shapesUserId = '98a94b95-cbd0-430b-8be2-602e1c75d8b0';
      const originalText = `Hello @[lbds137](user:${shapesUserId})`;
      const personality = createMockPersonality({
        systemPrompt: originalText,
      });

      mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([
        {
          shapesUserId,
          persona: {
            id: 'persona-uuid',
            name: 'lbds137',
            preferredName: 'Lila',
            pronouns: null,
            content: '',
          },
        },
      ]);

      const result = await resolver.resolvePersonalityReferences(personality);

      // Original should be unchanged
      expect(personality.systemPrompt).toBe(originalText);
      // Result should be modified
      expect(result.resolvedPersonality.systemPrompt).toBe('Hello Lila');
    });

    it('should skip empty and undefined fields', async () => {
      const personality = createMockPersonality({
        systemPrompt: '',
        characterInfo: 'No references here',
        personalityTone: undefined,
        personalityAge: null,
      });

      const result = await resolver.resolvePersonalityReferences(personality);

      // Should return personality with unchanged values
      expect(result.resolvedPersonality.systemPrompt).toBe('');
      expect(result.resolvedPersonality.characterInfo).toBe('No references here');
      expect(result.resolvedPersonas).toHaveLength(0);

      // No DB calls because no references pattern in text
      expect(mockPrisma.shapesPersonaMapping.findMany).not.toHaveBeenCalled();
    });

    it('should process fields in parallel', async () => {
      vi.useFakeTimers();

      const shapesUserId = '98a94b95-cbd0-430b-8be2-602e1c75d8b0';
      const personality = createMockPersonality({
        systemPrompt: `@[user](user:${shapesUserId})`,
        characterInfo: `@[user](user:${shapesUserId})`,
        conversationalExamples: `@[user](user:${shapesUserId})`,
      });

      let callCount = 0;
      mockPrisma.shapesPersonaMapping.findMany.mockImplementation(async () => {
        callCount++;
        // Simulate async delay
        await new Promise(resolve => setTimeout(resolve, 10));
        return [
          {
            shapesUserId,
            persona: {
              id: 'persona-uuid',
              name: 'user',
              preferredName: 'Resolved',
              pronouns: null,
              content: '',
            },
          },
        ];
      });

      // Start the resolution (don't await yet)
      const resultPromise = resolver.resolvePersonalityReferences(personality);

      // Advance timers - if parallel, one tick of 10ms should resolve all
      // If sequential, would need 30ms (3 * 10ms)
      await vi.advanceTimersByTimeAsync(15);

      // Should complete with parallel execution
      const result = await resultPromise;

      // Should have made 3 DB calls (one per field with reference)
      expect(callCount).toBe(3);
      expect(result.resolvedPersonality.systemPrompt).toBe('Resolved');

      vi.useRealTimers();
    });
  });
});
