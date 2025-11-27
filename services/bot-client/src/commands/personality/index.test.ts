/**
 * Tests for Personality Command Router
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { data, execute } from './index.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';

// Mock requireBotOwner middleware
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    requireBotOwner: vi.fn(),
    getConfig: vi.fn(() => ({
      GATEWAY_URL: 'http://localhost:3000',
    })),
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock subcommand handlers
vi.mock('./create.js', () => ({
  handleCreate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./edit.js', () => ({
  handleEdit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./import.js', () => ({
  handleImport: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./create-modal.js', () => ({
  handleCreateModal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./modal.js', () => ({
  handleModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

import { requireBotOwner, getConfig } from '@tzurot/common-types';
import { handleCreate } from './create.js';
import { handleEdit } from './edit.js';
import { handleImport } from './import.js';
import { handleCreateModal } from './create-modal.js';
import { handleModalSubmit } from './modal.js';

describe('personality command', () => {
  describe('data (SlashCommandBuilder)', () => {
    it('should have correct command name and description', () => {
      expect(data.name).toBe('personality');
      expect(data.description).toBe('Manage AI personalities');
    });

    it('should have create subcommand', () => {
      const options = data.options ?? [];
      const createSubcommand = options.find(opt => 'name' in opt && opt.name === 'create');

      expect(createSubcommand).toBeDefined();
    });

    it('should have edit subcommand', () => {
      const options = data.options ?? [];
      const editSubcommand = options.find(opt => 'name' in opt && opt.name === 'edit');

      expect(editSubcommand).toBeDefined();
    });

    it('should have import subcommand', () => {
      const options = data.options ?? [];
      const importSubcommand = options.find(opt => 'name' in opt && opt.name === 'import');

      expect(importSubcommand).toBeDefined();
    });

    it('should have create-modal subcommand', () => {
      const options = data.options ?? [];
      const createModalSubcommand = options.find(
        opt => 'name' in opt && opt.name === 'create-modal'
      );

      expect(createModalSubcommand).toBeDefined();
    });
  });

  describe('execute (router)', () => {
    let mockInteraction: ChatInputCommandInteraction | ModalSubmitInteraction;

    beforeEach(() => {
      vi.clearAllMocks();

      mockInteraction = {
        user: { id: 'test-user-id' },
        isModalSubmit: vi.fn().mockReturnValue(false),
        options: {
          getSubcommand: vi.fn(),
        },
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatInputCommandInteraction;
    });

    it('should check owner permission before executing', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(false);

      await execute(mockInteraction);

      expect(requireBotOwner).toHaveBeenCalledWith(mockInteraction);
    });

    it('should route to handleCreate for create subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('create');

      await execute(mockInteraction);

      const config = getConfig();
      expect(handleCreate).toHaveBeenCalledWith(mockInteraction, config);
    });

    it('should route to handleEdit for edit subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('edit');

      await execute(mockInteraction);

      const config = getConfig();
      expect(handleEdit).toHaveBeenCalledWith(mockInteraction, config);
    });

    it('should route to handleImport for import subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('import');

      await execute(mockInteraction);

      const config = getConfig();
      expect(handleImport).toHaveBeenCalledWith(mockInteraction, config);
    });

    it('should route to handleCreateModal for create-modal subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('create-modal');

      await execute(mockInteraction);

      expect(handleCreateModal).toHaveBeenCalledWith(mockInteraction);
    });

    it('should route to handleModalSubmit for modal submissions', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      mockInteraction.isModalSubmit = vi.fn().mockReturnValue(true);

      await execute(mockInteraction);

      const config = getConfig();
      expect(handleModalSubmit).toHaveBeenCalledWith(mockInteraction, config);
    });

    it('should handle unknown subcommand', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('unknown');

      await execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should prioritize modal submit over chat input', async () => {
      vi.mocked(requireBotOwner).mockResolvedValue(true);
      mockInteraction.isModalSubmit = vi.fn().mockReturnValue(true);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('create');

      await execute(mockInteraction);

      // Should call modal handler, not create handler
      expect(handleModalSubmit).toHaveBeenCalled();
      expect(handleCreate).not.toHaveBeenCalled();
    });
  });
});
