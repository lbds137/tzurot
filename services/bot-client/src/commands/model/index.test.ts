/**
 * Tests for Model Command Group
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
vi.mock('./list.js', () => ({ handleListOverrides: vi.fn() }));
vi.mock('./set.js', () => ({ handleSet: vi.fn() }));
vi.mock('./reset.js', () => ({ handleReset: vi.fn() }));

import { handleListOverrides } from './list.js';
import { handleSet } from './set.js';
import { handleReset } from './reset.js';

describe('Model Command', () => {
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

  it('should route "list" to handleListOverrides', async () => {
    const interaction = createMockInteraction('list');
    await execute(interaction);
    expect(handleListOverrides).toHaveBeenCalledWith(interaction);
  });

  it('should route "set" to handleSet', async () => {
    const interaction = createMockInteraction('set');
    await execute(interaction);
    expect(handleSet).toHaveBeenCalledWith(interaction);
  });

  it('should route "reset" to handleReset', async () => {
    const interaction = createMockInteraction('reset');
    await execute(interaction);
    expect(handleReset).toHaveBeenCalledWith(interaction);
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
