/**
 * Tests for Character Delete Handler
 *
 * Tests /character delete subcommand:
 * - Character not found
 * - Permission denied (canEdit: false)
 * - Cancel button cancels deletion
 * - Confirm button triggers deletion
 * - Deletion counts displayed correctly
 * - API error handling
 * - Timeout handling
 * - Contract validation with DeletePersonalityResponseSchema
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleDelete } from './delete.js';
import * as api from './api.js';
import * as userGatewayClient from '../../utils/userGatewayClient.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { EnvConfig } from '@tzurot/common-types';
import { DeletePersonalityResponseSchema } from '@tzurot/common-types';

// Mock dependencies
vi.mock('./api.js', () => ({
  fetchCharacter: vi.fn(),
}));

vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('Character Delete Handler', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  // Shared mock message for awaitMessageComponent
  let mockButtonInteraction: {
    customId: string;
    user: { id: string };
    update: ReturnType<typeof vi.fn>;
  };

  const createMockInteraction = (slug: string) => {
    const mockReply = {
      id: 'reply-123',
      awaitMessageComponent: vi.fn(),
    };

    return {
      user: { id: 'user-123' },
      channelId: 'channel-456',
      options: {
        getString: vi.fn((_name: string, _required?: boolean) => slug),
      },
      deferReply: vi.fn(),
      editReply: vi.fn().mockResolvedValue(mockReply),
    } as unknown as ChatInputCommandInteraction & {
      editReply: ReturnType<typeof vi.fn>;
    };
  };

  const createMockCharacter = (overrides = {}) => ({
    id: 'char-uuid-1',
    name: 'Test Character',
    displayName: 'Test Display',
    slug: 'test-character',
    canEdit: true,
    ...overrides,
  });

  const createMockDeleteResponse = (overrides = {}) => ({
    success: true,
    deletedSlug: 'test-character',
    deletedName: 'Test Character',
    deletedCounts: {
      conversationHistory: 10,
      memories: 5,
      pendingMemories: 2,
      activatedChannels: 1,
      aliases: 0,
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Set up default button interaction mock
    mockButtonInteraction = {
      customId: 'character_delete_confirm',
      user: { id: 'user-123' },
      update: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('handleDelete', () => {
    it('should defer reply as ephemeral', async () => {
      const mockInteraction = createMockInteraction('test-character');
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter());

      // Set up awaitMessageComponent to resolve with cancel button
      mockButtonInteraction.customId = 'character_delete_cancel';
      const mockReply = {
        awaitMessageComponent: vi.fn().mockResolvedValue(mockButtonInteraction),
      };
      mockInteraction.editReply.mockResolvedValue(mockReply);

      await handleDelete(mockInteraction, mockConfig);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    });

    it('should return error when character not found', async () => {
      const mockInteraction = createMockInteraction('nonexistent');
      vi.mocked(api.fetchCharacter).mockResolvedValue(null);

      await handleDelete(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should return error when user cannot edit character', async () => {
      const mockInteraction = createMockInteraction('other-char');
      vi.mocked(api.fetchCharacter).mockResolvedValue(
        createMockCharacter({ canEdit: false, slug: 'other-char' })
      );

      await handleDelete(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.stringContaining("don't have permission")
      );
    });

    it('should show confirmation embed with warning about data deletion', async () => {
      const mockInteraction = createMockInteraction('test-character');
      const mockCharacter = createMockCharacter();
      vi.mocked(api.fetchCharacter).mockResolvedValue(mockCharacter);

      mockButtonInteraction.customId = 'character_delete_cancel';
      const mockReply = {
        awaitMessageComponent: vi.fn().mockResolvedValue(mockButtonInteraction),
      };
      mockInteraction.editReply.mockResolvedValue(mockReply);

      await handleDelete(mockInteraction, mockConfig);

      // First call should be the confirmation embed
      const firstCall = mockInteraction.editReply.mock.calls[0][0];
      expect(firstCall).toHaveProperty('embeds');
      expect(firstCall).toHaveProperty('components');

      // Check embed has warning content
      const embed = firstCall.embeds[0];
      expect(embed.data.title).toContain('Delete');
      expect(embed.data.description).toContain('permanently delete');
      expect(embed.data.description).toContain('conversation history');
      expect(embed.data.description).toContain('memories');
    });

    it('should cancel deletion when cancel button clicked', async () => {
      const mockInteraction = createMockInteraction('test-character');
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter());

      mockButtonInteraction.customId = 'character_delete_cancel';
      const mockReply = {
        awaitMessageComponent: vi.fn().mockResolvedValue(mockButtonInteraction),
      };
      mockInteraction.editReply.mockResolvedValue(mockReply);

      await handleDelete(mockInteraction, mockConfig);

      // Verify update was called with cancellation message
      expect(mockButtonInteraction.update).toHaveBeenCalledWith({
        content: expect.stringContaining('cancelled'),
        embeds: [],
        components: [],
      });

      // Verify DELETE API was NOT called
      expect(userGatewayClient.callGatewayApi).not.toHaveBeenCalled();
    });

    it('should delete character when confirm button clicked', async () => {
      const mockInteraction = createMockInteraction('test-character');
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter());

      mockButtonInteraction.customId = 'character_delete_confirm';
      const mockReply = {
        awaitMessageComponent: vi.fn().mockResolvedValue(mockButtonInteraction),
      };
      mockInteraction.editReply.mockResolvedValue(mockReply);

      const deleteResponse = createMockDeleteResponse();
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: deleteResponse,
      });

      await handleDelete(mockInteraction, mockConfig);

      // Verify DELETE API was called with correct parameters
      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith(
        '/user/personality/test-character',
        expect.objectContaining({
          method: 'DELETE',
          userId: 'user-123',
        })
      );
    });

    it('should display deletion counts in success message', async () => {
      const mockInteraction = createMockInteraction('test-character');
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter());

      mockButtonInteraction.customId = 'character_delete_confirm';
      const mockReply = {
        awaitMessageComponent: vi.fn().mockResolvedValue(mockButtonInteraction),
      };
      mockInteraction.editReply.mockResolvedValue(mockReply);

      const deleteResponse = createMockDeleteResponse({
        deletedCounts: {
          conversationHistory: 42,
          memories: 7,
          pendingMemories: 3,
          activatedChannels: 2,
          aliases: 1,
        },
      });
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: deleteResponse,
      });

      await handleDelete(mockInteraction, mockConfig);

      // Verify final editReply contains counts
      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('42 conversation');
      expect(lastCall?.content).toContain('7 long-term');
      expect(lastCall?.content).toContain('3 pending');
      expect(lastCall?.content).toContain('2 activated');
      expect(lastCall?.content).toContain('1 alias');
    });

    it('should handle API error gracefully', async () => {
      const mockInteraction = createMockInteraction('test-character');
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter());

      mockButtonInteraction.customId = 'character_delete_confirm';
      const mockReply = {
        awaitMessageComponent: vi.fn().mockResolvedValue(mockButtonInteraction),
      };
      mockInteraction.editReply.mockResolvedValue(mockReply);

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'Server error',
      });

      await handleDelete(mockInteraction, mockConfig);

      // Verify error message shown
      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('Failed to delete');
      expect(lastCall?.content).toContain('Server error');
    });

    it('should handle timeout gracefully', async () => {
      const mockInteraction = createMockInteraction('test-character');
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter());

      const mockReply = {
        awaitMessageComponent: vi.fn().mockRejectedValue(new Error('time')),
      };
      mockInteraction.editReply.mockResolvedValue(mockReply);

      await handleDelete(mockInteraction, mockConfig);

      // Verify timeout message shown
      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('timed out');
    });

    it('should validate response against DeletePersonalityResponseSchema (contract test)', async () => {
      const mockInteraction = createMockInteraction('test-character');
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter());

      mockButtonInteraction.customId = 'character_delete_confirm';
      const mockReply = {
        awaitMessageComponent: vi.fn().mockResolvedValue(mockButtonInteraction),
      };
      mockInteraction.editReply.mockResolvedValue(mockReply);

      // Valid response that matches the schema
      const validResponse = createMockDeleteResponse();
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: validResponse,
      });

      await handleDelete(mockInteraction, mockConfig);

      // Verify the response would pass schema validation
      const parseResult = DeletePersonalityResponseSchema.safeParse(validResponse);
      expect(parseResult.success).toBe(true);

      // Verify success message shown (not schema error)
      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('permanently deleted');
    });

    it('should handle schema validation failure gracefully', async () => {
      const mockInteraction = createMockInteraction('test-character');
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter());

      mockButtonInteraction.customId = 'character_delete_confirm';
      const mockReply = {
        awaitMessageComponent: vi.fn().mockResolvedValue(mockButtonInteraction),
      };
      mockInteraction.editReply.mockResolvedValue(mockReply);

      // Invalid response missing required fields
      const invalidResponse = { success: true };
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: invalidResponse,
      });

      await handleDelete(mockInteraction, mockConfig);

      // Should still show success since API returned 200
      // (response is validated but we handle gracefully)
      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('deleted');
    });

    it('should handle zero counts (no extra data to delete)', async () => {
      const mockInteraction = createMockInteraction('test-character');
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter());

      mockButtonInteraction.customId = 'character_delete_confirm';
      const mockReply = {
        awaitMessageComponent: vi.fn().mockResolvedValue(mockButtonInteraction),
      };
      mockInteraction.editReply.mockResolvedValue(mockReply);

      const deleteResponse = createMockDeleteResponse({
        deletedCounts: {
          conversationHistory: 0,
          memories: 0,
          pendingMemories: 0,
          activatedChannels: 0,
          aliases: 0,
        },
      });
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: deleteResponse,
      });

      await handleDelete(mockInteraction, mockConfig);

      // Verify success message without counts section
      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('permanently deleted');
      // Should NOT contain "Deleted data:" section since all counts are 0
      expect(lastCall?.content).not.toContain('Deleted data:');
    });

    it('should handle fetch errors gracefully', async () => {
      const mockInteraction = createMockInteraction('error-char');
      vi.mocked(api.fetchCharacter).mockRejectedValue(new Error('Network error'));

      await handleDelete(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to process'),
        })
      );
    });

    it('should use correct button filter to only accept original user', async () => {
      const mockInteraction = createMockInteraction('test-character');
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter());

      mockButtonInteraction.customId = 'character_delete_cancel';
      const mockAwaitMessageComponent = vi.fn().mockResolvedValue(mockButtonInteraction);
      const mockReply = {
        awaitMessageComponent: mockAwaitMessageComponent,
      };
      mockInteraction.editReply.mockResolvedValue(mockReply);

      await handleDelete(mockInteraction, mockConfig);

      // Verify awaitMessageComponent was called with filter
      expect(mockAwaitMessageComponent).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.any(Function),
        })
      );

      // Test the filter function
      const filterFn = mockAwaitMessageComponent.mock.calls[0][0].filter;
      expect(filterFn({ user: { id: 'user-123' } })).toBe(true);
      expect(filterFn({ user: { id: 'different-user' } })).toBe(false);
    });

    it('should correctly pluralize memory counts', async () => {
      const mockInteraction = createMockInteraction('test-character');
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter());

      mockButtonInteraction.customId = 'character_delete_confirm';
      const mockReply = {
        awaitMessageComponent: vi.fn().mockResolvedValue(mockButtonInteraction),
      };
      mockInteraction.editReply.mockResolvedValue(mockReply);

      // Test singular memory
      const deleteResponse = createMockDeleteResponse({
        deletedCounts: {
          conversationHistory: 1,
          memories: 1,
          pendingMemories: 1,
          activatedChannels: 0,
          aliases: 0,
        },
      });
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: deleteResponse,
      });

      await handleDelete(mockInteraction, mockConfig);

      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('1 long-term memory');
      expect(lastCall?.content).not.toContain('1 long-term memories');
      expect(lastCall?.content).toContain('1 pending memory');
      expect(lastCall?.content).not.toContain('1 pending memories');
    });
  });
});
