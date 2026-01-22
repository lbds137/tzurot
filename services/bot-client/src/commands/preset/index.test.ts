/**
 * Tests for Preset Command Group
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import presetCommand from './index.js';

// Destructure from default export
const { data, execute } = presetCommand;

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock requireBotOwnerContext from factories
const mockRequireBotOwnerContext = vi.fn();
vi.mock('../../utils/commandContext/factories.js', () => ({
  requireBotOwnerContext: (...args: unknown[]) => mockRequireBotOwnerContext(...args),
}));

// Mock subcommand handlers
vi.mock('./list.js', () => ({ handleList: vi.fn() }));
vi.mock('./create.js', () => ({ handleCreate: vi.fn() }));
vi.mock('./delete.js', () => ({ handleDelete: vi.fn() }));

// Mock global subcommand handlers
vi.mock('./global/create.js', () => ({ handleGlobalCreate: vi.fn() }));
vi.mock('./global/set-default.js', () => ({ handleGlobalSetDefault: vi.fn() }));
vi.mock('./global/set-free-default.js', () => ({ handleGlobalSetFreeDefault: vi.fn() }));

import { handleList } from './list.js';
import { handleCreate } from './create.js';
import { handleDelete } from './delete.js';
import { handleGlobalCreate } from './global/create.js';
import { handleGlobalSetDefault } from './global/set-default.js';
import { handleGlobalSetFreeDefault } from './global/set-free-default.js';

describe('Preset Command', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(subcommand: string, subcommandGroup: string | null = null) {
    return {
      user: { id: '123456789' },
      interaction: {
        options: {
          getSubcommand: () => subcommand,
          getSubcommandGroup: () => subcommandGroup,
        },
      },
      getSubcommand: () => subcommand,
      getSubcommandGroup: () => subcommandGroup,
      editReply: mockEditReply,
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
      expect(globalSubcommands).toContain('default');
      expect(globalSubcommands).toContain('free-default');
      // Note: 'edit' was removed - global presets can be edited via /preset edit
    });
  });

  describe('user preset routing', () => {
    it('should route "list" to handleList', async () => {
      const context = createMockContext('list');
      await execute(context);
      expect(handleList).toHaveBeenCalledWith(context);
    });

    it('should route "create" to handleCreate', async () => {
      const context = createMockContext('create');
      await execute(context);
      expect(handleCreate).toHaveBeenCalledWith(context);
    });

    it('should route "delete" to handleDelete', async () => {
      const context = createMockContext('delete');
      await execute(context);
      expect(handleDelete).toHaveBeenCalledWith(context);
    });

    it('should reply with error for unknown subcommand', async () => {
      const context = createMockContext('unknown');
      await execute(context);
      // Note: editReply doesn't need flags - ephemerality is set at deferral time
      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ Unknown subcommand',
      });
    });
  });

  describe('global preset routing (owner only)', () => {
    it('should check owner permission for global create', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(false);
      const context = createMockContext('create', 'global');

      await execute(context);

      expect(mockRequireBotOwnerContext).toHaveBeenCalledWith(context);
      expect(handleGlobalCreate).not.toHaveBeenCalled();
    });

    it('should route to handleGlobalCreate when owner check passes', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(true);
      const context = createMockContext('create', 'global');

      await execute(context);

      expect(handleGlobalCreate).toHaveBeenCalledWith(context);
    });

    it('should route to handleGlobalSetDefault when owner check passes', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(true);
      const context = createMockContext('default', 'global');

      await execute(context);

      expect(handleGlobalSetDefault).toHaveBeenCalledWith(context);
    });

    it('should route to handleGlobalSetFreeDefault when owner check passes', async () => {
      mockRequireBotOwnerContext.mockResolvedValue(true);
      const context = createMockContext('free-default', 'global');

      await execute(context);

      expect(handleGlobalSetFreeDefault).toHaveBeenCalledWith(context);
    });
  });
});
