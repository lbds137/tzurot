/**
 * Tests for dashboardDeleteHandlers
 *
 * Tests handleDeleteAction (show confirmation) and handleDeleteButton (confirm/cancel).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import type { EnvConfig } from '@tzurot/common-types';

// Mock dependencies
vi.mock('./api.js', () => ({
  fetchCharacter: vi.fn(),
}));

const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

vi.mock('../../utils/dashboard/deleteConfirmation.js', () => ({
  buildDeleteConfirmation: vi.fn().mockReturnValue({
    embed: { data: {} },
    components: [{ type: 1 }],
  }),
}));

vi.mock('../../utils/dashboard/messages.js', () => ({
  DASHBOARD_MESSAGES: {
    NOT_FOUND: (type: string) => `${type} not found`,
    NO_PERMISSION: (action: string) => `No permission to ${action}`,
  },
}));

vi.mock('../../utils/customIds.js', () => ({
  CharacterCustomIds: {
    deleteConfirm: (slug: string) => `character::delete_confirm::${slug}`,
    deleteCancel: (slug: string) => `character::delete_cancel::${slug}`,
  },
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
    DeletePersonalityResponseSchema: {
      safeParse: vi.fn().mockReturnValue({
        success: true,
        data: {
          deletedCounts: {
            conversationHistory: 5,
            memories: 3,
            pendingMemories: 0,
            channelSettings: 1,
            aliases: 0,
          },
          deletedName: 'Test Character',
          deletedSlug: 'test-char',
        },
      }),
    },
  };
});

import { fetchCharacter } from './api.js';
import { handleDeleteAction, handleDeleteButton } from './dashboardDeleteHandlers.js';

function createMockButtonInteraction(overrides?: Partial<ButtonInteraction>): ButtonInteraction {
  return {
    customId: 'character::delete::test-char',
    user: { id: 'user-123' },
    message: { id: 'msg-123' },
    channelId: 'channel-123',
    reply: vi.fn(),
    update: vi.fn(),
    editReply: vi.fn(),
    deferUpdate: vi.fn(),
    ...overrides,
  } as unknown as ButtonInteraction;
}

describe('dashboardDeleteHandlers', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallGatewayApi.mockReset();
  });

  describe('handleDeleteAction', () => {
    it('should show not found message when character does not exist', async () => {
      vi.mocked(fetchCharacter).mockResolvedValue(null);
      const interaction = createMockButtonInteraction();

      await handleDeleteAction(interaction, 'test-char', mockConfig);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Character not found',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should show no permission message when user cannot edit', async () => {
      vi.mocked(fetchCharacter).mockResolvedValue({
        name: 'Test Character',
        canEdit: false,
      } as ReturnType<typeof fetchCharacter> extends Promise<infer T> ? NonNullable<T> : never);
      const interaction = createMockButtonInteraction();

      await handleDeleteAction(interaction, 'test-char', mockConfig);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'No permission to delete this character',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should show confirmation dialog when character exists and user can edit', async () => {
      vi.mocked(fetchCharacter).mockResolvedValue({
        name: 'Test Character',
        displayName: 'Test Display',
        canEdit: true,
      } as ReturnType<typeof fetchCharacter> extends Promise<infer T> ? NonNullable<T> : never);
      const interaction = createMockButtonInteraction();

      await handleDeleteAction(interaction, 'test-char', mockConfig);

      expect(interaction.update).toHaveBeenCalledWith({
        embeds: [{ data: {} }],
        components: [{ type: 1 }],
      });
    });
  });

  describe('handleDeleteButton', () => {
    it('should cancel deletion when not confirmed', async () => {
      const interaction = createMockButtonInteraction();

      await handleDeleteButton(interaction, 'test-char', false);

      expect(interaction.update).toHaveBeenCalledWith({
        content: expect.stringContaining('Deletion cancelled'),
        embeds: [],
        components: [],
      });
      expect(mockCallGatewayApi).not.toHaveBeenCalled();
    });

    it('should delete character when confirmed', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          deletedCounts: {
            conversationHistory: 5,
            memories: 3,
            pendingMemories: 0,
            channelSettings: 1,
            aliases: 0,
          },
          deletedName: 'Test Character',
          deletedSlug: 'test-char',
        },
      });
      const interaction = createMockButtonInteraction();

      await handleDeleteButton(interaction, 'test-char', true);

      expect(interaction.update).toHaveBeenCalledWith({
        content: expect.stringContaining('Deleting character'),
        embeds: [],
        components: [],
      });
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/test-char', {
        method: 'DELETE',
        userId: 'user-123',
      });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('deleted'),
        embeds: [],
        components: [],
      });
    });

    it('should show error on API failure', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Character not found',
      });
      const interaction = createMockButtonInteraction();

      await handleDeleteButton(interaction, 'test-char', true);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to delete'),
        embeds: [],
        components: [],
      });
    });
  });
});
