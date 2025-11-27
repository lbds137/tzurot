/**
 * Tests for Settings Command Group (Timezone)
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
vi.mock('./timezone.js', () => ({
  handleTimezoneSet: vi.fn(),
  handleTimezoneGet: vi.fn(),
}));

import { handleTimezoneSet, handleTimezoneGet } from './timezone.js';

describe('Settings Command (timezone)', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(group: string | null, subcommand: string) {
    return {
      user: { id: '123456789' },
      options: {
        getSubcommandGroup: () => group,
        getSubcommand: () => subcommand,
      },
      reply: mockReply,
    } as unknown as Parameters<typeof execute>[0];
  }

  it('should route "set" subcommand to handleTimezoneSet', async () => {
    const interaction = createMockInteraction('timezone', 'set');

    await execute(interaction);

    expect(handleTimezoneSet).toHaveBeenCalledWith(interaction);
    expect(handleTimezoneGet).not.toHaveBeenCalled();
  });

  it('should route "get" subcommand to handleTimezoneGet', async () => {
    const interaction = createMockInteraction('timezone', 'get');

    await execute(interaction);

    expect(handleTimezoneGet).toHaveBeenCalledWith(interaction);
    expect(handleTimezoneSet).not.toHaveBeenCalled();
  });

  it('should reply with error for unknown subcommand in timezone group', async () => {
    const interaction = createMockInteraction('timezone', 'unknown');

    await execute(interaction);

    expect(mockReply).toHaveBeenCalledWith({
      content: '❌ Unknown subcommand',
      flags: MessageFlags.Ephemeral,
    });
    expect(handleTimezoneSet).not.toHaveBeenCalled();
    expect(handleTimezoneGet).not.toHaveBeenCalled();
  });

  it('should log warning for unknown subcommand group', async () => {
    const interaction = createMockInteraction('unknown-group', 'set');

    await execute(interaction);

    // Unknown group should not route to any handler
    expect(handleTimezoneSet).not.toHaveBeenCalled();
    expect(handleTimezoneGet).not.toHaveBeenCalled();
  });
});
