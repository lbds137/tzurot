/**
 * Tests for Settings Command Group (Timezone)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { execute, autocomplete } from './index.js';

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
    // Provide a small set of timezone options for testing
    TIMEZONE_OPTIONS: [
      { value: 'America/New_York', label: 'Eastern Time', offset: 'UTC-5' },
      { value: 'America/Los_Angeles', label: 'Pacific Time', offset: 'UTC-8' },
      { value: 'Europe/London', label: 'London', offset: 'UTC+0' },
      { value: 'Asia/Tokyo', label: 'Tokyo', offset: 'UTC+9' },
    ],
    DISCORD_LIMITS: {
      AUTOCOMPLETE_MAX_CHOICES: 25,
    },
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

describe('Settings Command (autocomplete)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockAutocompleteInteraction(optionName: string, value: string) {
    return {
      options: {
        getFocused: vi.fn(() => ({ name: optionName, value })),
      },
      respond: vi.fn(),
    } as unknown as Parameters<typeof autocomplete>[0];
  }

  it('should filter timezones by value match', async () => {
    const interaction = createMockAutocompleteInteraction('timezone', 'new_york');

    await autocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([
      expect.objectContaining({
        name: expect.stringContaining('Eastern Time'),
        value: 'America/New_York',
      }),
    ]);
  });

  it('should filter timezones by label match', async () => {
    const interaction = createMockAutocompleteInteraction('timezone', 'pacific');

    await autocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([
      expect.objectContaining({
        name: expect.stringContaining('Pacific Time'),
        value: 'America/Los_Angeles',
      }),
    ]);
  });

  it('should filter timezones by offset match', async () => {
    const interaction = createMockAutocompleteInteraction('timezone', 'utc+9');

    await autocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([
      expect.objectContaining({
        name: expect.stringContaining('Tokyo'),
        value: 'Asia/Tokyo',
      }),
    ]);
  });

  it('should be case-insensitive', async () => {
    const interaction = createMockAutocompleteInteraction('timezone', 'LONDON');

    await autocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([
      expect.objectContaining({
        value: 'Europe/London',
      }),
    ]);
  });

  it('should return all timezones for empty query', async () => {
    const interaction = createMockAutocompleteInteraction('timezone', '');

    await autocomplete(interaction);

    const response = (interaction.respond as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response).toHaveLength(4); // All mocked timezones
  });

  it('should respond with empty array for non-timezone options', async () => {
    const interaction = createMockAutocompleteInteraction('other-option', 'test');

    await autocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });
});
