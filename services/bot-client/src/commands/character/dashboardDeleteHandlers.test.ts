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
vi.mock('../../utils/userGatewayClient.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils/userGatewayClient.js')>(
    '../../utils/userGatewayClient.js'
  );
  return {
    ...actual,
    callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  };
});

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
  formatSuccessBanner: (verb: string, name: string) => `✅ **${verb}** · ${name}`,
}));

vi.mock('../../utils/customIds.js', () => ({
  CharacterCustomIds: {
    deleteConfirm: (slug: string) => `character::delete_confirm::${slug}`,
    deleteCancel: (slug: string) => `character::delete_cancel::${slug}`,
  },
}));

const mockSessionGet = vi.fn();
vi.mock('../../utils/dashboard/SessionManager.js', () => ({
  getSessionManager: () => ({
    get: mockSessionGet,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

const mockRenderPostActionScreen = vi.fn();
vi.mock('../../utils/dashboard/postActionScreen.js', () => ({
  renderPostActionScreen: (...args: unknown[]) => mockRenderPostActionScreen(...args),
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
    user: { id: 'user-123', username: 'testuser' },
    message: { id: 'msg-123' },
    channelId: 'channel-123',
    reply: vi.fn(),
    update: vi.fn(),
    editReply: vi.fn(),
    followUp: vi.fn(),
    deferUpdate: vi.fn(),
    ...overrides,
  } as unknown as ButtonInteraction;
}

describe('dashboardDeleteHandlers', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallGatewayApi.mockReset();
    mockSessionGet.mockReset();
    mockRenderPostActionScreen.mockReset();
    // Default: no session (simulates dashboard opened via /character view with
    // no browseContext). Individual tests override when they need a session.
    mockSessionGet.mockResolvedValue(null);
  });

  describe('handleDeleteAction', () => {
    it('should show not found message when character does not exist', async () => {
      vi.mocked(fetchCharacter).mockResolvedValue(null);
      const interaction = createMockButtonInteraction();

      await handleDeleteAction(interaction, 'test-char', mockConfig);

      // 3-sec budget guard: handler defers FIRST, then does the gateway fetch,
      // then uses followUp for the ephemeral error branches.
      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(interaction.followUp).toHaveBeenCalledWith({
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

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(interaction.followUp).toHaveBeenCalledWith({
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

      // After deferUpdate, the confirmation dialog is sent via editReply
      // (which edits the deferred placeholder message in place), not update.
      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
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

      // Ack via deferUpdate (no intermediate progress message).
      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/test-char', {
        method: 'DELETE',
        user: {
          discordId: 'user-123',
          username: 'testuser',
          displayName: 'testuser',
        },
      });
      // Success goes through renderPostActionScreen — the helper decides
      // success-with-rebuild vs clean-terminal based on browseContext.
      expect(mockRenderPostActionScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({
            entityType: 'character',
            entityId: 'test-char',
            browseContext: undefined,
          }),
          outcome: expect.objectContaining({
            kind: 'success',
            banner: expect.stringContaining('Test Character'),
          }),
        })
      );
    });

    it('should carry browseContext from session into the post-action screen', async () => {
      const browseContext = { page: 2, filter: 'all', sort: 'date' };
      mockSessionGet.mockResolvedValue({ data: { browseContext } });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          deletedCounts: {
            conversationHistory: 0,
            memories: 0,
            pendingMemories: 0,
            channelSettings: 0,
            aliases: 0,
          },
          deletedName: 'Test Character',
          deletedSlug: 'test-char',
        },
      });
      const interaction = createMockButtonInteraction();

      await handleDeleteButton(interaction, 'test-char', true);

      expect(mockRenderPostActionScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({ browseContext }),
        })
      );
    });

    it('should show error on API failure', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Character not found',
      });
      const interaction = createMockButtonInteraction();

      await handleDeleteButton(interaction, 'test-char', true);

      expect(mockRenderPostActionScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: expect.objectContaining({
            kind: 'error',
            content: expect.stringContaining('Failed to delete'),
          }),
        })
      );
    });

    // Covers the review gap from PR #842 — the schema-validation fallback
    // branch (safeParse returns { success: false }) had no explicit test.
    // Imports `DeletePersonalityResponseSchema` from the mocked module-level
    // object so we can override safeParse for this single case.
    it('should render success via fallback banner when schema validation fails', async () => {
      const { DeletePersonalityResponseSchema } = await import('@tzurot/common-types');
      vi.mocked(DeletePersonalityResponseSchema.safeParse).mockReturnValueOnce({
        success: false,
        error: { message: 'schema drift' } as never,
      } as never);

      mockCallGatewayApi.mockResolvedValue({ ok: true, data: { unexpected: 'shape' } });
      const interaction = createMockButtonInteraction();

      await handleDeleteButton(interaction, 'test-char', true);

      expect(mockRenderPostActionScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: expect.objectContaining({
            kind: 'success',
            // Fallback banner uses the slug since deletedName isn't
            // available from the malformed response.
            banner: expect.stringContaining('test-char'),
          }),
        })
      );
    });

    // Covers the try/catch review note — when callGatewayApi throws
    // (network-level failure), the handler should render a graceful error
    // rather than propagating to CommandHandler's generic reply.
    it('should render graceful error when callGatewayApi throws', async () => {
      mockCallGatewayApi.mockRejectedValueOnce(new Error('network down'));
      const interaction = createMockButtonInteraction();

      await handleDeleteButton(interaction, 'test-char', true);

      expect(mockRenderPostActionScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: expect.objectContaining({
            kind: 'error',
            content: expect.stringContaining('error occurred'),
          }),
        })
      );
    });
  });
});
