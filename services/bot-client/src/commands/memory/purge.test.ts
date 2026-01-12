/**
 * Tests for Memory Purge Handler
 *
 * Tests /memory purge subcommand:
 * - Two-step confirmation: Danger button → Typed confirmation modal
 * - Stats API call to show what will be purged
 * - Purge API call on correct confirmation
 * - Cancel, timeout, and phrase mismatch handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePurge } from './purge.js';
import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock commandHelpers
const mockReplyWithError = vi.fn();
const mockHandleCommandError = vi.fn();
vi.mock('../../utils/commandHelpers.js', () => ({
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
  createDangerEmbed: vi.fn((_title: string, _description: string) => ({
    toJSON: () => ({ title: 'Test Danger' }),
  })),
  createSuccessEmbed: vi.fn((_title: string, _description: string) => ({
    toJSON: () => ({ title: 'Test Success' }),
  })),
}));

// Mock autocomplete
const mockResolvePersonalityId = vi.fn();
vi.mock('./autocomplete.js', () => ({
  resolvePersonalityId: (...args: unknown[]) => mockResolvePersonalityId(...args),
}));

describe('handlePurge', () => {
  const mockEditReply = vi.fn();
  const mockAwaitMessageComponent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockEditReply.mockResolvedValue({
      awaitMessageComponent: mockAwaitMessageComponent,
    });
  });

  function createMockInteraction(personality = 'lilith') {
    return {
      user: { id: 'user-123' },
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'personality') return personality;
          return null;
        },
      },
      editReply: mockEditReply,
    } as unknown as ChatInputCommandInteraction;
  }

  function createMockButtonInteraction(customId: string, userId = 'user-123') {
    const mockAwaitModalSubmit = vi.fn();
    const mockShowModal = vi.fn().mockResolvedValue(undefined);

    return {
      customId,
      user: { id: userId },
      update: vi.fn().mockResolvedValue(undefined),
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      showModal: mockShowModal,
      awaitModalSubmit: mockAwaitModalSubmit,
      // Expose mocks for assertions
      _mockAwaitModalSubmit: mockAwaitModalSubmit,
      _mockShowModal: mockShowModal,
    } as unknown as ButtonInteraction & {
      update: ReturnType<typeof vi.fn>;
      deferUpdate: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      showModal: ReturnType<typeof vi.fn>;
      awaitModalSubmit: ReturnType<typeof vi.fn>;
      _mockAwaitModalSubmit: ReturnType<typeof vi.fn>;
      _mockShowModal: ReturnType<typeof vi.fn>;
    };
  }

  function createMockModalInteraction(phrase: string, userId = 'user-123') {
    return {
      user: { id: userId },
      customId: 'memory_purge_confirm_personality-uuid-123',
      fields: {
        getTextInputValue: vi.fn((_fieldId: string) => phrase),
      },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction & {
      deferUpdate: ReturnType<typeof vi.fn>;
      reply: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
    };
  }

  describe('validation', () => {
    it('should show error when personality not found', async () => {
      mockResolvePersonalityId.mockResolvedValue(null);
      const interaction = createMockInteraction('unknown-personality');

      await handlePurge(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        expect.stringContaining('not found')
      );
    });

    it('should resolve personality slug to ID', async () => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          personaId: 'persona-123',
          totalCount: 0,
          lockedCount: 0,
        },
      });

      const interaction = createMockInteraction('lilith');
      await handlePurge(interaction);

      expect(mockResolvePersonalityId).toHaveBeenCalledWith('user-123', 'lilith');
    });
  });

  describe('stats API', () => {
    beforeEach(() => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
    });

    it('should show error when stats API fails', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      expect(mockReplyWithError).toHaveBeenCalled();
    });

    it('should show 404 message when personality not found in stats', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Not found',
      });

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        expect.stringContaining('not found')
      );
    });

    it('should show "no memories" message when nothing to purge', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          personaId: 'persona-123',
          totalCount: 0,
          lockedCount: 0,
        },
      });

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('No memories found'),
      });
    });
  });

  describe('confirmation buttons', () => {
    beforeEach(() => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          personaId: 'persona-123',
          totalCount: 10,
          lockedCount: 2,
        },
      });
    });

    it('should show danger embed with memory counts', async () => {
      mockAwaitMessageComponent.mockRejectedValue(new Error('timeout'));
      const interaction = createMockInteraction();

      await handlePurge(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
        components: expect.any(Array),
      });
    });

    it('should cancel when user clicks cancel button', async () => {
      const buttonInteraction = createMockButtonInteraction('memory_purge_cancel');
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      expect(buttonInteraction.update).toHaveBeenCalledWith({
        content: 'Purge cancelled.',
        embeds: [],
        components: [],
      });
    });

    it('should handle button timeout', async () => {
      mockAwaitMessageComponent.mockRejectedValue(new Error('timeout'));

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      expect(mockEditReply).toHaveBeenLastCalledWith({
        content: 'Purge cancelled - confirmation timed out.',
        embeds: [],
        components: [],
      });
    });
  });

  describe('modal confirmation', () => {
    beforeEach(() => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          personaId: 'persona-123',
          totalCount: 10,
          lockedCount: 2,
        },
      });
    });

    it('should show modal when user proceeds', async () => {
      const buttonInteraction = createMockButtonInteraction('memory_purge_proceed');
      buttonInteraction._mockAwaitModalSubmit.mockRejectedValue(new Error('timeout'));
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      expect(buttonInteraction._mockShowModal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Confirm Memory Purge',
          }),
        })
      );
    });

    it('should cancel when modal times out', async () => {
      const buttonInteraction = createMockButtonInteraction('memory_purge_proceed');
      buttonInteraction._mockAwaitModalSubmit.mockRejectedValue(new Error('timeout'));
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      expect(mockEditReply).toHaveBeenLastCalledWith({
        content: 'Purge cancelled - confirmation timed out.',
        embeds: [],
        components: [],
      });
    });

    it('should cancel when confirmation phrase does not match', async () => {
      const buttonInteraction = createMockButtonInteraction('memory_purge_proceed');
      const modalInteraction = createMockModalInteraction('wrong phrase');
      buttonInteraction._mockAwaitModalSubmit.mockResolvedValue(modalInteraction);
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      // Should reply with ephemeral error
      expect(modalInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('did not match'),
        ephemeral: true,
      });

      // Should update original message
      expect(mockEditReply).toHaveBeenLastCalledWith({
        content: 'Purge cancelled - confirmation phrase did not match.',
        embeds: [],
        components: [],
      });
    });
  });

  describe('purge execution', () => {
    beforeEach(() => {
      mockResolvePersonalityId.mockResolvedValue('personality-uuid-123');
    });

    it('should perform purge when confirmation phrase matches', async () => {
      // Stats API
      mockCallGatewayApi
        .mockResolvedValueOnce({
          ok: true,
          data: {
            personalityId: 'personality-uuid-123',
            personalityName: 'Lilith',
            personaId: 'persona-123',
            totalCount: 10,
            lockedCount: 2,
          },
        })
        // Purge API
        .mockResolvedValueOnce({
          ok: true,
          data: {
            deletedCount: 8,
            lockedPreserved: 2,
            personalityId: 'personality-uuid-123',
            personalityName: 'Lilith',
            message: 'Purged 8 memories. 2 locked memories preserved.',
          },
        });

      const buttonInteraction = createMockButtonInteraction('memory_purge_proceed');
      const modalInteraction = createMockModalInteraction('DELETE LILITH MEMORIES');
      buttonInteraction._mockAwaitModalSubmit.mockResolvedValue(modalInteraction);
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      // Verify purge API was called with correct params
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/memory/purge',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            personalityId: 'personality-uuid-123',
            confirmationPhrase: 'DELETE LILITH MEMORIES',
          }),
        })
      );

      // Verify success message shown
      expect(modalInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
        components: [],
      });
    });

    it('should defer modal update before API call', async () => {
      mockCallGatewayApi
        .mockResolvedValueOnce({
          ok: true,
          data: {
            personalityId: 'personality-uuid-123',
            personalityName: 'Test',
            personaId: 'persona-123',
            totalCount: 5,
            lockedCount: 0,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            deletedCount: 5,
            lockedPreserved: 0,
            personalityId: 'personality-uuid-123',
            personalityName: 'Test',
            message: 'Purged 5 memories.',
          },
        });

      const buttonInteraction = createMockButtonInteraction('memory_purge_proceed');
      const modalInteraction = createMockModalInteraction('DELETE TEST MEMORIES');
      buttonInteraction._mockAwaitModalSubmit.mockResolvedValue(modalInteraction);
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      expect(modalInteraction.deferUpdate).toHaveBeenCalled();
    });

    it('should show error when purge API fails', async () => {
      mockCallGatewayApi
        .mockResolvedValueOnce({
          ok: true,
          data: {
            personalityId: 'personality-uuid-123',
            personalityName: 'Lilith',
            personaId: 'persona-123',
            totalCount: 10,
            lockedCount: 0,
          },
        })
        .mockResolvedValueOnce({
          ok: false,
          error: 'Database error',
        });

      const buttonInteraction = createMockButtonInteraction('memory_purge_proceed');
      const modalInteraction = createMockModalInteraction('DELETE LILITH MEMORIES');
      buttonInteraction._mockAwaitModalSubmit.mockResolvedValue(modalInteraction);
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      expect(modalInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to purge'),
        embeds: [],
        components: [],
      });
    });

    it('should handle case-sensitive confirmation phrase', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personalityId: 'personality-uuid-123',
          personalityName: 'Lilith',
          personaId: 'persona-123',
          totalCount: 5,
          lockedCount: 0,
        },
      });

      const buttonInteraction = createMockButtonInteraction('memory_purge_proceed');
      // Wrong case
      const modalInteraction = createMockModalInteraction('delete lilith memories');
      buttonInteraction._mockAwaitModalSubmit.mockResolvedValue(modalInteraction);
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      // Should reject - phrase is case-sensitive (uppercase expected)
      expect(modalInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('did not match'),
        ephemeral: true,
      });
    });

    it('should trim whitespace from confirmation phrase', async () => {
      mockCallGatewayApi
        .mockResolvedValueOnce({
          ok: true,
          data: {
            personalityId: 'personality-uuid-123',
            personalityName: 'Lilith',
            personaId: 'persona-123',
            totalCount: 5,
            lockedCount: 0,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            deletedCount: 5,
            lockedPreserved: 0,
            personalityId: 'personality-uuid-123',
            personalityName: 'Lilith',
            message: 'Purged 5 memories.',
          },
        });

      const buttonInteraction = createMockButtonInteraction('memory_purge_proceed');
      // Phrase with leading/trailing whitespace
      const modalInteraction = createMockModalInteraction('  DELETE LILITH MEMORIES  ');
      buttonInteraction._mockAwaitModalSubmit.mockResolvedValue(modalInteraction);
      mockAwaitMessageComponent.mockResolvedValue(buttonInteraction);

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      // Should succeed after trimming
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/memory/purge', expect.any(Object));
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      mockResolvePersonalityId.mockRejectedValue(new Error('Unexpected error'));

      const interaction = createMockInteraction();
      await handlePurge(interaction);

      expect(mockHandleCommandError).toHaveBeenCalled();
    });
  });
});
