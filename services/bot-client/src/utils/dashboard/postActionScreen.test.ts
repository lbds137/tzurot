import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import type { BrowseContext } from './types.js';
import type { TerminalScreenSession } from './terminalScreen.js';

// Mock renderTerminalScreen so we can assert how the post-action helper
// delegates to it without exercising its internals (tested separately).
const mockRenderTerminalScreen = vi.fn();
vi.mock('./terminalScreen.js', () => ({
  renderTerminalScreen: (...args: unknown[]) => mockRenderTerminalScreen(...args),
}));

// Mock session manager so we can assert session deletion on the success path.
const mockSessionDelete = vi.fn();
vi.mock('./SessionManager.js', () => ({
  getSessionManager: () => ({ delete: mockSessionDelete }),
}));

import { renderPostActionScreen } from './postActionScreen.js';
import {
  registerBrowseRebuilder,
  clearBrowseRegistry,
  type BrowseRebuilder,
} from './browseRebuilderRegistry.js';

const browseContext: BrowseContext = {
  source: 'browse',
  page: 1,
  filter: 'all',
  sort: 'name',
};

function makeInteraction(): ButtonInteraction {
  return { editReply: vi.fn() } as unknown as ButtonInteraction;
}

function makeSession(overrides: Partial<TerminalScreenSession> = {}): TerminalScreenSession {
  return {
    userId: 'user-1',
    entityType: 'preset',
    entityId: 'entity-1',
    browseContext,
    ...overrides,
  };
}

describe('renderPostActionScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBrowseRegistry();
  });

  describe('success path with browseContext', () => {
    it('calls the registered rebuilder, deletes the session, and editReplies the rebuilt view', async () => {
      const rebuilt = { content: 'banner', embeds: [], components: [] };
      const rebuilder: BrowseRebuilder = vi.fn(async () => rebuilt);
      registerBrowseRebuilder('preset', rebuilder);

      const interaction = makeInteraction();
      const session = makeSession();

      await renderPostActionScreen({
        interaction,
        session,
        outcome: { kind: 'success', banner: '✅ **Deleted** · MyPreset' },
      });

      expect(rebuilder).toHaveBeenCalledWith(
        interaction,
        browseContext,
        '✅ **Deleted** · MyPreset'
      );
      expect(mockSessionDelete).toHaveBeenCalledWith('user-1', 'preset', 'entity-1');
      expect(interaction.editReply).toHaveBeenCalledWith(rebuilt);
      expect(mockRenderTerminalScreen).not.toHaveBeenCalled();
    });

    it('falls through to error terminal when no rebuilder is registered for the entity type', async () => {
      // Deliberately DO NOT register a rebuilder
      const interaction = makeInteraction();
      const session = makeSession();

      await renderPostActionScreen({
        interaction,
        session,
        outcome: { kind: 'success', banner: '✅ **Deleted** · MyPreset' },
      });

      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          interaction,
          session,
          content: expect.stringContaining('✅ **Deleted** · MyPreset'),
        })
      );
      // Banner preserved + error note appended
      expect(mockRenderTerminalScreen.mock.calls[0]?.[0].content).toMatch(
        /Could not reload the browse list/
      );
      expect(mockSessionDelete).not.toHaveBeenCalled();
    });

    it('falls through to error terminal when rebuilder returns null (rebuild failed)', async () => {
      const rebuilder: BrowseRebuilder = vi.fn(async () => null);
      registerBrowseRebuilder('preset', rebuilder);

      const interaction = makeInteraction();
      const session = makeSession();

      await renderPostActionScreen({
        interaction,
        session,
        outcome: { kind: 'success', banner: '✅ **Deleted** · MyPreset' },
      });

      expect(rebuilder).toHaveBeenCalled();
      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Could not reload the browse list'),
        })
      );
      // Session NOT deleted on fallback path — terminal screen handles cleanup
      expect(mockSessionDelete).not.toHaveBeenCalled();
    });

    it('falls through to error terminal when rebuilder throws', async () => {
      const rebuilder: BrowseRebuilder = vi.fn(async () => {
        throw new Error('network down');
      });
      registerBrowseRebuilder('preset', rebuilder);

      const interaction = makeInteraction();
      const session = makeSession();

      await renderPostActionScreen({
        interaction,
        session,
        outcome: { kind: 'success', banner: '✅ **Deleted** · MyPreset' },
      });

      expect(rebuilder).toHaveBeenCalled();
      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Could not reload the browse list'),
        })
      );
    });
  });

  describe('success path without browseContext', () => {
    it('renders a clean terminal with the banner as content', async () => {
      const interaction = makeInteraction();
      const session = makeSession({ browseContext: undefined });

      await renderPostActionScreen({
        interaction,
        session,
        outcome: { kind: 'success', banner: '✅ **Deleted** · MyPreset' },
      });

      // No rebuilder call, no session-delete from us (renderTerminalScreen handles it)
      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          interaction,
          session,
          content: '✅ **Deleted** · MyPreset',
        })
      );
    });

    it('handles a null session (no session was ever created)', async () => {
      const interaction = makeInteraction();

      await renderPostActionScreen({
        interaction,
        session: null,
        outcome: { kind: 'success', banner: '✅ Done' },
      });

      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({ session: null, content: '✅ Done' })
      );
    });
  });

  describe('error path', () => {
    it('delegates to renderTerminalScreen with context for the Back-to-Browse button', async () => {
      const interaction = makeInteraction();
      const session = makeSession();

      await renderPostActionScreen({
        interaction,
        session,
        outcome: { kind: 'error', content: '❌ Failed to delete preset.' },
      });

      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          interaction,
          session,
          content: '❌ Failed to delete preset.',
        })
      );
      // Error path does NOT call the rebuilder, even when one is registered
      // and browseContext is present.
    });

    it('delegates to renderTerminalScreen without context for a clean terminal', async () => {
      const interaction = makeInteraction();
      const session = makeSession({ browseContext: undefined });

      await renderPostActionScreen({
        interaction,
        session,
        outcome: { kind: 'error', content: '❌ Failed.' },
      });

      expect(mockRenderTerminalScreen).toHaveBeenCalledWith(
        expect.objectContaining({ session, content: '❌ Failed.' })
      );
    });
  });
});
