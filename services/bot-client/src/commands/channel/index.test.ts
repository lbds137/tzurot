/**
 * Tests for /channel command group
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { data, execute, autocomplete } from './index.js';

// Mock handlers
vi.mock('./activate.js', () => ({
  handleActivate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./deactivate.js', () => ({
  handleDeactivate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./list.js', () => ({
  handleList: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./autocomplete.js', () => ({
  handleAutocomplete: vi.fn().mockResolvedValue(undefined),
}));

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

import { handleActivate } from './activate.js';
import { handleDeactivate } from './deactivate.js';
import { handleList } from './list.js';
import { handleAutocomplete } from './autocomplete.js';

describe('/channel command group', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command definition', () => {
    it('should have correct command name', () => {
      expect(data.name).toBe('channel');
    });

    it('should have description', () => {
      expect(data.description).toBeDefined();
      expect(data.description.length).toBeGreaterThan(0);
    });

    it('should have activate subcommand', () => {
      const json = data.toJSON();
      const activateSubcommand = json.options?.find(
        (opt: { name: string }) => opt.name === 'activate'
      );
      expect(activateSubcommand).toBeDefined();
    });

    it('should have deactivate subcommand', () => {
      const json = data.toJSON();
      const deactivateSubcommand = json.options?.find(
        (opt: { name: string }) => opt.name === 'deactivate'
      );
      expect(deactivateSubcommand).toBeDefined();
    });

    it('should have list subcommand', () => {
      const json = data.toJSON();
      const listSubcommand = json.options?.find((opt: { name: string }) => opt.name === 'list');
      expect(listSubcommand).toBeDefined();
    });
  });

  describe('execute', () => {
    function createMockInteraction(subcommand: string): ChatInputCommandInteraction {
      return {
        options: {
          getSubcommand: vi.fn().mockReturnValue(subcommand),
        },
        user: { id: 'user-123' },
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatInputCommandInteraction;
    }

    it('should route to activate handler', async () => {
      const interaction = createMockInteraction('activate');

      await execute(interaction);

      expect(handleActivate).toHaveBeenCalledWith(interaction);
    });

    it('should route to deactivate handler', async () => {
      const interaction = createMockInteraction('deactivate');

      await execute(interaction);

      expect(handleDeactivate).toHaveBeenCalledWith(interaction);
    });

    it('should route to list handler', async () => {
      const interaction = createMockInteraction('list');

      await execute(interaction);

      expect(handleList).toHaveBeenCalledWith(interaction);
    });
  });

  describe('autocomplete', () => {
    it('should call handleAutocomplete', async () => {
      const interaction = {
        options: {
          getSubcommand: vi.fn().mockReturnValue('activate'),
        },
        user: { id: 'user-123' },
      } as unknown as AutocompleteInteraction;

      await autocomplete(interaction);

      expect(handleAutocomplete).toHaveBeenCalledWith(interaction);
    });
  });
});
