/**
 * Tests for Preset Global Edit Handler
 *
 * Tests /preset global edit subcommand:
 * - Successful preset updates
 * - Partial field updates
 * - No fields provided error
 * - API error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGlobalEdit } from './edit.js';
import * as adminApiClient from '../../../utils/adminApiClient.js';
import * as commandHelpers from '../../../utils/commandHelpers.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

// Mock dependencies
vi.mock('../../../utils/adminApiClient.js', () => ({
  adminPutJson: vi.fn(),
}));

vi.mock('../../../utils/commandHelpers.js', () => ({
  replyWithError: vi.fn(),
  handleCommandError: vi.fn(),
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

describe('Preset Global Edit Handler', () => {
  const createMockInteraction = (options: Record<string, string | null>) =>
    ({
      user: { id: 'owner-123' },
      options: {
        getString: vi.fn((name: string, _required?: boolean) => {
          return options[name] ?? null;
        }),
      },
      editReply: vi.fn(),
    }) as unknown as ChatInputCommandInteraction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleGlobalEdit', () => {
    it('should successfully update preset with all fields', async () => {
      const mockInteraction = createMockInteraction({
        config: 'config-123',
        name: 'New Name',
        model: 'new-model',
        provider: 'gemini',
        description: 'New description',
        'vision-model': 'vision-model-1',
      });

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          config: { id: 'config-123', name: 'New Name', model: 'new-model' },
        }),
      } as unknown as Response);

      await handleGlobalEdit(mockInteraction);

      expect(adminApiClient.adminPutJson).toHaveBeenCalledWith('/admin/llm-config/config-123', {
        name: 'New Name',
        model: 'new-model',
        provider: 'gemini',
        description: 'New description',
        visionModel: 'vision-model-1',
      });

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });
    });

    it('should update preset with single field', async () => {
      const mockInteraction = createMockInteraction({
        config: 'config-123',
        name: 'Only Name Updated',
      });

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          config: { id: 'config-123', name: 'Only Name Updated', model: 'existing-model' },
        }),
      } as unknown as Response);

      await handleGlobalEdit(mockInteraction);

      expect(adminApiClient.adminPutJson).toHaveBeenCalledWith('/admin/llm-config/config-123', {
        name: 'Only Name Updated',
      });
    });

    it('should show error when no fields provided', async () => {
      const mockInteraction = createMockInteraction({
        config: 'config-123',
        // No other fields
      });

      await handleGlobalEdit(mockInteraction);

      expect(commandHelpers.replyWithError).toHaveBeenCalledWith(
        mockInteraction,
        'No fields to update. Provide at least one option.'
      );
      expect(adminApiClient.adminPutJson).not.toHaveBeenCalled();
    });

    it('should handle API error response', async () => {
      const mockInteraction = createMockInteraction({
        config: 'config-123',
        name: 'New Name',
      });

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ error: 'Config not found' }),
      } as unknown as Response);

      await handleGlobalEdit(mockInteraction);

      expect(commandHelpers.replyWithError).toHaveBeenCalledWith(
        mockInteraction,
        'Config not found'
      );
    });

    it('should handle API error without message', async () => {
      const mockInteraction = createMockInteraction({
        config: 'config-123',
        name: 'New Name',
      });

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({}),
      } as unknown as Response);

      await handleGlobalEdit(mockInteraction);

      expect(commandHelpers.replyWithError).toHaveBeenCalledWith(mockInteraction, 'HTTP 500');
    });

    it('should handle network errors with handleCommandError', async () => {
      const mockInteraction = createMockInteraction({
        config: 'config-123',
        name: 'New Name',
      });

      const networkError = new Error('Network error');
      vi.mocked(adminApiClient.adminPutJson).mockRejectedValue(networkError);

      await handleGlobalEdit(mockInteraction);

      expect(commandHelpers.handleCommandError).toHaveBeenCalledWith(
        mockInteraction,
        networkError,
        { userId: 'owner-123', command: 'Preset Global Edit' }
      );
    });

    it('should show updated fields in success embed', async () => {
      const mockInteraction = createMockInteraction({
        config: 'config-123',
        name: 'New Name',
        model: 'new-model',
      });

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          config: { id: 'config-123', name: 'New Name', model: 'new-model' },
        }),
      } as unknown as Response);

      await handleGlobalEdit(mockInteraction);

      const embedCall = vi.mocked(mockInteraction.editReply).mock.calls[0][0] as {
        embeds: EmbedBuilder[];
      };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toBe('Global Preset Updated');
      const updatedFieldsField = embedData.fields?.find(f => f.name === 'Updated Fields');
      expect(updatedFieldsField?.value).toContain('name');
      expect(updatedFieldsField?.value).toContain('model');
    });
  });
});
