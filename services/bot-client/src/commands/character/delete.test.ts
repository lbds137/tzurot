/**
 * Tests for Character Delete Handler
 *
 * Tests delete confirmation button handling:
 * - handleDeleteButton: Handles confirm/cancel button clicks from dashboard
 *
 * Note: The confirmation dialog is shown via the dashboard (handleDeleteAction).
 * This test file focuses on the button click handling after confirmation is shown.
 *
 * This uses the global button handler pattern instead of awaitMessageComponent
 * because awaitMessageComponent doesn't work reliably in multi-replica deployments.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleDeleteButton } from './delete.js';
import * as userGatewayClient from '../../utils/userGatewayClient.js';
import type { ButtonInteraction } from 'discord.js';
import { DeletePersonalityResponseSchema } from '@tzurot/common-types';
import { CharacterCustomIds } from '../../utils/customIds.js';

// Mock dependencies
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

  describe('handleDeleteButton (handles confirm/cancel clicks)', () => {
    it('should cancel deletion when confirmed=false', async () => {
      const mockContext = createMockButtonInteraction(
        CharacterCustomIds.deleteCancel('test-character')
      );

      await handleDeleteButton(mockContext, 'test-character', false);

      expect(mockContext.update).toHaveBeenCalledWith({
        content: expect.stringContaining('cancelled'),
        embeds: [],
        components: [],
      });

      // Verify DELETE API was NOT called
      expect(userGatewayClient.callGatewayApi).not.toHaveBeenCalled();
    });

    it('should delete character when confirmed=true', async () => {
      const mockContext = createMockButtonInteraction(
        CharacterCustomIds.deleteConfirm('test-character')
      );

      const deleteResponse = createMockDeleteResponse();
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: deleteResponse,
      });

      await handleDeleteButton(mockContext, 'test-character', true);

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
      const mockContext = createMockButtonInteraction(
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

      await handleDeleteButton(mockContext, 'test-character', true);

      // Verify final editReply contains counts
      const lastCall = mockContext.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('42 conversation');
      expect(lastCall?.content).toContain('7 long-term');
      expect(lastCall?.content).toContain('3 pending');
      expect(lastCall?.content).toContain('2 channel setting');
      expect(lastCall?.content).toContain('1 alias');
    });

    it('should handle API error gracefully', async () => {
      const mockContext = createMockButtonInteraction(
        CharacterCustomIds.deleteConfirm('test-character')
      );

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'Server error',
      });

      await handleDeleteButton(mockContext, 'test-character', true);

      // Verify error message shown
      const lastCall = mockContext.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('Failed to delete');
      expect(lastCall?.content).toContain('Server error');
    });

    it('should validate response against DeletePersonalityResponseSchema (contract test)', async () => {
      const mockContext = createMockButtonInteraction(
        CharacterCustomIds.deleteConfirm('test-character')
      );

      // Valid response that matches the schema
      const validResponse = createMockDeleteResponse();
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: validResponse,
      });

      await handleDeleteButton(mockContext, 'test-character', true);

      // Verify the response would pass schema validation
      const parseResult = DeletePersonalityResponseSchema.safeParse(validResponse);
      expect(parseResult.success).toBe(true);

      // Verify success message shown (not schema error)
      const lastCall = mockContext.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('permanently deleted');
    });

    it('should handle schema validation failure gracefully', async () => {
      const mockContext = createMockButtonInteraction(
        CharacterCustomIds.deleteConfirm('test-character')
      );

      // Invalid response missing required fields
      const invalidResponse = { success: true };
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: invalidResponse,
      });

      await handleDeleteButton(mockContext, 'test-character', true);

      // Should still show success since API returned 200
      // (response is validated but we handle gracefully)
      const lastCall = mockContext.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('deleted');
    });

    it('should handle zero counts (no extra data to delete)', async () => {
      const mockContext = createMockButtonInteraction(
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

      await handleDeleteButton(mockContext, 'test-character', true);

      // Verify success message without counts section
      const lastCall = mockContext.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('permanently deleted');
      // Should NOT contain "Deleted data:" section since all counts are 0
      expect(lastCall?.content).not.toContain('Deleted data:');
    });

    it('should correctly pluralize memory counts', async () => {
      const mockContext = createMockButtonInteraction(
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

      await handleDeleteButton(mockContext, 'test-character', true);

      const lastCall = mockContext.editReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.content).toContain('1 long-term memory');
      expect(lastCall?.content).not.toContain('1 long-term memories');
      expect(lastCall?.content).toContain('1 pending memory');
      expect(lastCall?.content).not.toContain('1 pending memories');
    });
  });
});
