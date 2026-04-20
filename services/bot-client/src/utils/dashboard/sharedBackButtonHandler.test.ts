import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import type { BrowseCapableEntityType } from './terminalScreen.js';
import type { BrowseContext } from './types.js';

// Mocks — renderTerminalScreen + SessionManager are collaborators; assert on
// the call shape rather than their internals.
const mockRenderTerminalScreen = vi.fn();
vi.mock('./terminalScreen.js', () => ({
  renderTerminalScreen: (...args: unknown[]) => mockRenderTerminalScreen(...args),
}));

const mockSessionGet = vi.fn();
const mockSessionDelete = vi.fn();
vi.mock('./SessionManager.js', () => ({
  getSessionManager: () => ({ get: mockSessionGet, delete: mockSessionDelete }),
}));

import { handleSharedBackButton } from './sharedBackButtonHandler.js';
import {
  registerBrowseRebuilder,
  clearBrowseRegistry,
  type BrowseRebuilder,
} from './browseRebuilderRegistry.js';

const validContext: BrowseContext = {
  source: 'browse',
  page: 2,
  filter: 'all',
  sort: 'name',
};

function makeInteraction(userId = 'user-1'): ButtonInteraction {
  return { user: { id: userId }, editReply: vi.fn() } as unknown as ButtonInteraction;
}

describe('handleSharedBackButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBrowseRegistry();
    mockSessionGet.mockResolvedValue(null);
  });

  // Parameterize the happy path + error branches across every
  // BrowseCapableEntityType — catches any keyed-lookup regression where the
  // registry key or the session key drifts from the entity type literal.
  const entityTypes: BrowseCapableEntityType[] = ['preset', 'character', 'persona', 'deny'];

  describe.each(entityTypes)('for entityType=%s', entityType => {
    it('fetches session, reads browseContext, invokes rebuilder, deletes session, and editReplies', async () => {
      mockSessionGet.mockResolvedValue({ data: { browseContext: validContext } });
      const rebuilt = { content: undefined, embeds: [], components: [] };
      const rebuilder: BrowseRebuilder = vi.fn(async () => rebuilt);
      registerBrowseRebuilder(entityType, rebuilder);

      const interaction = makeInteraction();
      await handleSharedBackButton(interaction, entityType, 'entity-1');

      expect(mockSessionGet).toHaveBeenCalledWith('user-1', entityType, 'entity-1');
      // No successBanner argument — back navigation, not a post-action
      expect(rebuilder).toHaveBeenCalledWith(interaction, validContext);
      expect(mockSessionDelete).toHaveBeenCalledWith('user-1', entityType, 'entity-1');
      expect(interaction.editReply).toHaveBeenCalledWith(rebuilt);
      expect(mockRenderTerminalScreen).not.toHaveBeenCalled();
    });

    it('renders session-expired terminal (no back button) when session is missing', async () => {
      mockSessionGet.mockResolvedValue(null);
      const interaction = makeInteraction();

      await handleSharedBackButton(interaction, entityType, 'entity-1');

      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          interaction,
          session: expect.objectContaining({ browseContext: undefined, entityType }),
          content: expect.stringContaining('expired'),
        })
      );
      expect(mockSessionDelete).not.toHaveBeenCalled();
    });

    it('renders expired terminal when session has no browseContext', async () => {
      mockSessionGet.mockResolvedValue({ data: { name: 'Something' } });
      const interaction = makeInteraction();

      await handleSharedBackButton(interaction, entityType, 'entity-1');

      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('expired') })
      );
    });

    it('renders error terminal when no rebuilder is registered', async () => {
      mockSessionGet.mockResolvedValue({ data: { browseContext: validContext } });
      // Deliberately no register call

      const interaction = makeInteraction();
      await handleSharedBackButton(interaction, entityType, 'entity-1');

      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('load browse list') })
      );
    });

    it('renders error terminal when rebuilder returns null', async () => {
      mockSessionGet.mockResolvedValue({ data: { browseContext: validContext } });
      const rebuilder: BrowseRebuilder = vi.fn(async () => null);
      registerBrowseRebuilder(entityType, rebuilder);

      const interaction = makeInteraction();
      await handleSharedBackButton(interaction, entityType, 'entity-1');

      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('load browse list') })
      );
      expect(mockSessionDelete).not.toHaveBeenCalled();
    });

    it('renders error terminal when rebuilder throws', async () => {
      mockSessionGet.mockResolvedValue({ data: { browseContext: validContext } });
      const rebuilder: BrowseRebuilder = vi.fn(async () => {
        throw new Error('boom');
      });
      registerBrowseRebuilder(entityType, rebuilder);

      const interaction = makeInteraction();
      await handleSharedBackButton(interaction, entityType, 'entity-1');

      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('load browse list') })
      );
    });
  });

  it('treats malformed browseContext as missing (guards against bad shape in session data)', async () => {
    mockSessionGet.mockResolvedValue({
      data: { browseContext: { source: 'browse', page: 'not-a-number', filter: 'all' } },
    });
    const interaction = makeInteraction();

    await handleSharedBackButton(interaction, 'preset', 'entity-1');

    expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
  });
});
