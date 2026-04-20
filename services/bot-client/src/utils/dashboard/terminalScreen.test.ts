// Tests for renderTerminalScreen.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import type { BrowseContext } from './types.js';

const mockSessionDelete = vi.fn();
vi.mock('./SessionManager.js', () => ({
  getSessionManager: () => ({
    delete: mockSessionDelete,
  }),
}));

const { renderTerminalScreen } = await import('./terminalScreen.js');

function createMockInteraction(): {
  interaction: ButtonInteraction;
  editReply: ReturnType<typeof vi.fn>;
} {
  const editReply = vi.fn().mockResolvedValue({});
  const interaction = { editReply } as unknown as ButtonInteraction;
  return { interaction, editReply };
}

describe('renderTerminalScreen', () => {
  beforeEach(() => {
    mockSessionDelete.mockReset();
  });

  describe('with browseContext present', () => {
    const browseContext: BrowseContext = {
      source: 'browse',
      page: 2,
      filter: 'all',
    };

    it('attaches a Back-to-Browse button using the entity type/id', async () => {
      const { interaction, editReply } = createMockInteraction();

      await renderTerminalScreen({
        interaction,
        session: {
          userId: 'u-1',
          entityType: 'preset',
          entityId: 'preset-123',
          browseContext,
        },
        content: '✅ Deleted.',
      });

      expect(editReply).toHaveBeenCalledTimes(1);
      const call = editReply.mock.calls[0][0] as {
        content: string;
        embeds: unknown[];
        components: unknown[];
      };
      expect(call.content).toBe('✅ Deleted.');
      expect(call.embeds).toEqual([]);
      expect(call.components).toHaveLength(1);

      // The back button's customId must route to `<entityType>::back::<entityId>`
      // so the existing handleBackButton in each command picks it up.
      const row = call.components[0] as { components: Array<{ data: { custom_id: string } }> };
      expect(row.components[0].data.custom_id).toBe('preset::back::preset-123');
    });

    it('keeps the session alive (back button needs it to read browseContext)', async () => {
      const { interaction } = createMockInteraction();

      await renderTerminalScreen({
        interaction,
        session: {
          userId: 'u-1',
          entityType: 'preset',
          entityId: 'preset-123',
          browseContext,
        },
        content: '✅ Deleted.',
      });

      expect(mockSessionDelete).not.toHaveBeenCalled();
    });

    it('derives the back customId from entityType — works for any command', async () => {
      const { interaction, editReply } = createMockInteraction();

      await renderTerminalScreen({
        interaction,
        session: {
          userId: 'u-1',
          entityType: 'character',
          entityId: 'char-456',
          browseContext,
        },
        content: 'done',
      });

      const call = editReply.mock.calls[0][0] as { components: unknown[] };
      const row = call.components[0] as { components: Array<{ data: { custom_id: string } }> };
      expect(row.components[0].data.custom_id).toBe('character::back::char-456');
    });

    it('forwards embeds when provided', async () => {
      const { interaction, editReply } = createMockInteraction();
      const embed = { title: 'Detail' };

      await renderTerminalScreen({
        interaction,
        session: {
          userId: 'u-1',
          entityType: 'preset',
          entityId: 'preset-123',
          browseContext,
        },
        content: 'x',
        embeds: [embed],
      });

      const call = editReply.mock.calls[0][0] as { embeds: unknown[] };
      expect(call.embeds).toEqual([embed]);
    });
  });

  describe('without browseContext', () => {
    it('renders with no components and deletes the session', async () => {
      const { interaction, editReply } = createMockInteraction();

      await renderTerminalScreen({
        interaction,
        session: {
          userId: 'u-1',
          entityType: 'preset',
          entityId: 'preset-123',
          browseContext: undefined,
        },
        content: '✅ Deleted.',
      });

      const call = editReply.mock.calls[0][0] as { components: unknown[] };
      expect(call.components).toEqual([]);
      expect(mockSessionDelete).toHaveBeenCalledWith('u-1', 'preset', 'preset-123');
    });

    it('handles a null session (session was already cleaned up) without crashing', async () => {
      const { interaction, editReply } = createMockInteraction();

      await renderTerminalScreen({
        interaction,
        session: null,
        content: '✅ Done.',
      });

      const call = editReply.mock.calls[0][0] as { components: unknown[] };
      expect(call.components).toEqual([]);
      expect(mockSessionDelete).not.toHaveBeenCalled();
    });
  });
});
