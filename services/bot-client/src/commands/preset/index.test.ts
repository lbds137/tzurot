/**
 * Tests for Preset Command Group
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import presetCommand from './index.js';

// Destructure from default export
const { data, execute } = presetCommand;

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    requireBotOwner: vi.fn(),
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock subcommand handlers
vi.mock('./list.js', () => ({ handleList: vi.fn() }));
vi.mock('./create.js', () => ({ handleCreate: vi.fn() }));
vi.mock('./delete.js', () => ({ handleDelete: vi.fn() }));

// Mock global subcommand handlers
vi.mock('./global/create.js', () => ({ handleGlobalCreate: vi.fn() }));
vi.mock('./global/edit.js', () => ({ handleGlobalEdit: vi.fn() }));
vi.mock('./global/set-default.js', () => ({ handleGlobalSetDefault: vi.fn() }));
vi.mock('./global/set-free-default.js', () => ({ handleGlobalSetFreeDefault: vi.fn() }));

import { requireBotOwner } from '@tzurot/common-types';
import { handleList } from './list.js';
import { handleCreate } from './create.js';
import { handleDelete } from './delete.js';
import { handleGlobalCreate } from './global/create.js';
import { handleGlobalEdit } from './global/edit.js';
import { handleGlobalSetDefault } from './global/set-default.js';
import { handleGlobalSetFreeDefault } from './global/set-free-default.js';

describe('Preset Command', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(subcommand: string, subcommandGroup: string | null = null) {
    return {
      user: { id: '123456789' },
      options: {
        getSubcommand: () => subcommand,
        getSubcommandGroup: () => subcommandGroup,
      },
      reply: mockReply,
    } as unknown as Parameters<typeof execute>[0];
  }

  describe('command data', () => {
    it('should have correct command name and description', () => {
      expect(data.name).toBe('preset');
      expect(data.description).toBe('Manage your model presets');
    });

    it('should have global subcommand group', () => {
      const json = data.toJSON();
      const options = json.options ?? [];

      // Find subcommand groups (type 2)
      const groups = options.filter((opt: { type: number }) => opt.type === 2);
      const globalGroup = groups.find((g: { name: string }) => g.name === 'global');

      expect(globalGroup).toBeDefined();

      // Check global group has expected subcommands
      const globalSubcommands = (globalGroup?.options ?? []).map((s: { name: string }) => s.name);
      expect(globalSubcommands).toContain('create');
      expect(globalSubcommands).toContain('edit');
      expect(globalSubcommands).toContain('set-default');
      expect(globalSubcommands).toContain('set-free-default');
    });
  });

  describe('user preset routing', () => {
    it('should route "list" to handleList', async () => {
      const interaction = createMockInteraction('list');
      await execute(interaction);
      expect(handleList).toHaveBeenCalledWith(interaction);
    });

    it('should route "create" to handleCreate', async () => {
      const interaction = createMockInteraction('create');
      await execute(interaction);
      expect(handleCreate).toHaveBeenCalledWith(interaction);
    });

    it('should route "delete" to handleDelete', async () => {
      const interaction = createMockInteraction('delete');
      await execute(interaction);
      expect(handleDelete).toHaveBeenCalledWith(interaction);
    });

    it('should reply with error for unknown subcommand', async () => {
      const interaction = createMockInteraction('unknown');
      await execute(interaction);
      expect(mockReply).toHaveBeenCalledWith({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe('global preset routing (owner only)', () => {
    it('should check owner permission for global create', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(false);
      const interaction = createMockInteraction('create', 'global');

      await execute(interaction);

      expect(requireBotOwner).toHaveBeenCalledWith(interaction);
      expect(handleGlobalCreate).not.toHaveBeenCalled();
    });

    it('should route to handleGlobalCreate when owner check passes', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      const interaction = createMockInteraction('create', 'global');

      await execute(interaction);

      expect(handleGlobalCreate).toHaveBeenCalledWith(interaction);
    });

    it('should route to handleGlobalEdit when owner check passes', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      const interaction = createMockInteraction('edit', 'global');

      await execute(interaction);

      expect(handleGlobalEdit).toHaveBeenCalledWith(interaction);
    });

    it('should route to handleGlobalSetDefault when owner check passes', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      const interaction = createMockInteraction('set-default', 'global');

      await execute(interaction);

      expect(handleGlobalSetDefault).toHaveBeenCalledWith(interaction);
    });

    it('should route to handleGlobalSetFreeDefault when owner check passes', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      const interaction = createMockInteraction('set-free-default', 'global');

      await execute(interaction);

      expect(handleGlobalSetFreeDefault).toHaveBeenCalledWith(interaction);
    });
  });
});
