/**
 * Tests for LLM Config Command Group
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { execute } from './index.js';

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

// Mock subcommand handlers
vi.mock('./list.js', () => ({ handleList: vi.fn() }));
vi.mock('./create.js', () => ({ handleCreate: vi.fn() }));
vi.mock('./delete.js', () => ({ handleDelete: vi.fn() }));

import { handleList } from './list.js';
import { handleCreate } from './create.js';
import { handleDelete } from './delete.js';

describe('LLM Config Command', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(subcommand: string) {
    return {
      user: { id: '123456789' },
      options: {
        getSubcommand: () => subcommand,
      },
      reply: mockReply,
    } as unknown as Parameters<typeof execute>[0];
  }

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
