/**
 * Tests for Character Delete Handler
 *
 * Tests /character delete subcommand with global button handler pattern:
 * - handleDelete: Shows confirmation dialog
 * - handleDeleteButton: Handles confirm/cancel button clicks
 *
 * This uses the global button handler pattern instead of awaitMessageComponent
 * because awaitMessageComponent doesn't work reliably in multi-replica deployments.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleDelete, handleDeleteButton } from './delete.js';
import * as api from './api.js';
import * as userGatewayClient from '../../utils/userGatewayClient.js';
import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import type { EnvConfig } from '@tzurot/common-types';
import { DeletePersonalityResponseSchema } from '@tzurot/common-types';
import { CharacterCustomIds } from '../../utils/customIds.js';

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

  const createMockCommandInteraction = (slug: string) => {
    return {
      user: { id: 'user-123' },
      channelId: 'channel-456',
      options: {
        getString: vi.fn((_name: string, _required?: boolean) => slug),
      },
      editReply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
    } as unknown as ChatInputCommandInteraction & {
      editReply: ReturnType<typeof vi.fn>;
    };
  };

  const createMockButtonInteraction = (customId: string, userId = 'user-123') => {
    return {
      customId,
      user: { id: userId },
      update: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction & {
      update: ReturnType<typeof vi.fn>;
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
      channelSettings: 1,
      aliases: 0,
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleDelete (shows confirmation dialog)', () => {
    // Note: deferReply is handled by top-level interactionCreate handler

    it('should return error when character not found', async () => {
      const mockInteraction = createMockCommandInteraction('nonexistent');
      vi.mocked(api.fetchCharacter).mockResolvedValue(null);

      await handleDelete(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should return error when user cannot edit character', async () => {
      const mockInteraction = createMockCommandInteraction('other-char');
      vi.mocked(api.fetchCharacter).mockResolvedValue(
        createMockCharacter({ canEdit: false, slug: 'other-char' })
      );

      await handleDelete(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.stringContaining("don't have permission")
      );
    });

    it('should show confirmation embed with warning about data deletion', async () => {
      const mockInteraction = createMockCommandInteraction('test-character');
      const mockCharacter = createMockCharacter();
      vi.mocked(api.fetchCharacter).mockResolvedValue(mockCharacter);

      await handleDelete(mockInteraction, mockConfig);

      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      expect(editReplyCall).toHaveProperty('embeds');
      expect(editReplyCall).toHaveProperty('components');

      // Check embed has warning content
      const embed = editReplyCall.embeds[0];
      expect(embed.data.title).toContain('Delete');
      expect(embed.data.description).toContain('permanently delete');
      expect(embed.data.description).toContain('conversation history');
      expect(embed.data.description).toContain('memories');
    });

    it('should use CharacterCustomIds for button customIds', async () => {
      const mockInteraction = createMockCommandInteraction('test-character');
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter());

      await handleDelete(mockInteraction, mockConfig);

      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      const components = editReplyCall.components[0].components;

      // Verify buttons use the correct customId pattern (:: delimiter)
      expect(components[0].data.custom_id).toBe(CharacterCustomIds.deleteConfirm('test-character'));
      expect(components[1].data.custom_id).toBe(CharacterCustomIds.deleteCancel('test-character'));
    });

    it('should handle fetch errors gracefully', async () => {
      const mockInteraction = createMockCommandInteraction('error-char');
      vi.mocked(api.fetchCharacter).mockRejectedValue(new Error('Network error'));

      await handleDelete(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to process'),
        })
      );
    });
  });

  describe('handleDeleteButton (handles confirm/cancel clicks)', () => {
    it('should cancel deletion when confirmed=false', async () => {
      const mockInteraction = createMockButtonInteraction(
        CharacterCustomIds.deleteCancel('test-character')
      );

      await handleDeleteButton(mockInteraction, 'test-character', false);

      expect(mockInteraction.update).toHaveBeenCalledWith({
        content: expect.stringContaining('cancelled'),
        embeds: [],
        components: [],
      });

      // Verify DELETE API was NOT called
      expect(userGatewayClient.callGatewayApi).not.toHaveBeenCalled();
    });

    it('should delete character when confirmed=true', async () => {
      const mockInteraction = createMockButtonInteraction(
        CharacterCustomIds.deleteConfirm('test-character')
      );

      const deleteResponse = createMockDeleteResponse();
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: deleteResponse,
      });

      await handleDeleteButton(mockInteraction, 'test-character', true);

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
      const mockInteraction = createMockButtonInteraction(
        CharacterCustomIds.deleteConfirm('test-character')
      );

      const deleteResponse = createMockDeleteResponse({
        deletedCounts: {
          conversationHistory: 42,
          memories: 7,
          pendingMemories: 3,
          channelSettings: 2,
          aliases: 1,
        },
      });
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: deleteResponse,
      });

      await handleDeleteButton(mockInteraction, 'test-character', true);

      // Verify final editReply contains counts
      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('42 conversation');
      expect(lastCall?.content).toContain('7 long-term');
      expect(lastCall?.content).toContain('3 pending');
      expect(lastCall?.content).toContain('2 channel setting');
      expect(lastCall?.content).toContain('1 alias');
    });

    it('should handle API error gracefully', async () => {
      const mockInteraction = createMockButtonInteraction(
        CharacterCustomIds.deleteConfirm('test-character')
      );

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'Server error',
      });

      await handleDeleteButton(mockInteraction, 'test-character', true);

      // Verify error message shown
      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('Failed to delete');
      expect(lastCall?.content).toContain('Server error');
    });

    it('should validate response against DeletePersonalityResponseSchema (contract test)', async () => {
      const mockInteraction = createMockButtonInteraction(
        CharacterCustomIds.deleteConfirm('test-character')
      );

      // Valid response that matches the schema
      const validResponse = createMockDeleteResponse();
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: validResponse,
      });

      await handleDeleteButton(mockInteraction, 'test-character', true);

      // Verify the response would pass schema validation
      const parseResult = DeletePersonalityResponseSchema.safeParse(validResponse);
      expect(parseResult.success).toBe(true);

      // Verify success message shown (not schema error)
      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('permanently deleted');
    });

    it('should handle schema validation failure gracefully', async () => {
      const mockInteraction = createMockButtonInteraction(
        CharacterCustomIds.deleteConfirm('test-character')
      );

      // Invalid response missing required fields
      const invalidResponse = { success: true };
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: invalidResponse,
      });

      await handleDeleteButton(mockInteraction, 'test-character', true);

      // Should still show success since API returned 200
      // (response is validated but we handle gracefully)
      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('deleted');
    });

    it('should handle zero counts (no extra data to delete)', async () => {
      const mockInteraction = createMockButtonInteraction(
        CharacterCustomIds.deleteConfirm('test-character')
      );

      const deleteResponse = createMockDeleteResponse({
        deletedCounts: {
          conversationHistory: 0,
          memories: 0,
          pendingMemories: 0,
          channelSettings: 0,
          aliases: 0,
        },
      });
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: deleteResponse,
      });

      await handleDeleteButton(mockInteraction, 'test-character', true);

      // Verify success message without counts section
      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('permanently deleted');
      // Should NOT contain "Deleted data:" section since all counts are 0
      expect(lastCall?.content).not.toContain('Deleted data:');
    });

    it('should correctly pluralize memory counts', async () => {
      const mockInteraction = createMockButtonInteraction(
        CharacterCustomIds.deleteConfirm('test-character')
      );

      // Test singular memory
      const deleteResponse = createMockDeleteResponse({
        deletedCounts: {
          conversationHistory: 1,
          memories: 1,
          pendingMemories: 1,
          channelSettings: 0,
          aliases: 0,
        },
      });
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: deleteResponse,
      });

      await handleDeleteButton(mockInteraction, 'test-character', true);

      const lastCall = mockInteraction.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('1 long-term memory');
      expect(lastCall?.content).not.toContain('1 long-term memories');
      expect(lastCall?.content).toContain('1 pending memory');
      expect(lastCall?.content).not.toContain('1 pending memories');
    });
  });
});
