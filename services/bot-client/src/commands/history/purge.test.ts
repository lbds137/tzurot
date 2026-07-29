/**
 * Tests for History Hard-Delete Subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { handlePurgeHistory, parsePurgeSlugFromFooter } from './purge.js';

// Mock common-types
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

// Mock the Tier-B destructive confirmation module
const mockBuildDestructiveWarning = vi.fn();
const mockCreateHardDeleteConfig = vi.fn(() => ({
  source: 'history',
  operation: 'history-purge',
  entityId: 'channel-123',
  footerText: 'slug:lilith',
}));
vi.mock('../../utils/confirmation/confirmDestructive.js', () => ({
  buildDestructiveWarning: (...args: unknown[]) =>
    mockBuildDestructiveWarning(...(args as Parameters<typeof mockBuildDestructiveWarning>)),
  createHardDeleteConfig: (...args: unknown[]) =>
    mockCreateHardDeleteConfig(...(args as Parameters<typeof mockCreateHardDeleteConfig>)),
}));

describe('handlePurgeHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildDestructiveWarning.mockReturnValue({
      embeds: [{ data: { title: 'Delete History' } }],
      components: [{ data: {} }],
    });
  });

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(
    personalitySlug: string = 'lilith',
    channelId: string = 'channel-123'
  ): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: {
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'character') return personalitySlug;
            return null;
          }),
          getBoolean: vi.fn(() => null),
          getInteger: vi.fn(() => null),
        },
      },
      user: { id: '123456789' },
      guild: null,
      member: null,
      channel: null,
      channelId,
      guildId: null,
      commandName: 'history',
      isEphemeral: true,
      getOption: vi.fn(),
      getRequiredOption: vi.fn((name: string) => {
        if (name === 'character') return personalitySlug;
        throw new Error(`Unknown required option: ${name}`);
      }),
      getSubcommand: () => 'purge',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  it('should show destructive warning with danger button', async () => {
    const context = createMockContext();
    await handlePurgeHistory(context);

    expect(mockCreateHardDeleteConfig).toHaveBeenCalledWith({
      entityType: 'conversation history',
      entityName: 'lilith',
      additionalWarning: expect.stringContaining('PERMANENT'),
      source: 'history',
      operation: 'history-purge',
      entityId: 'channel-123',
      footerText: 'slug:lilith',
    });
    // The warning must state the TRUE scope (persona-scoped) — the old copy
    // claimed "All messages in this channel" while deleting only the caller's.
    const firstCall = mockCreateHardDeleteConfig.mock.calls[0] as unknown as [
      { additionalWarning: string },
    ];
    const warning = firstCall[0].additionalWarning;
    expect(warning).toContain('**Your** conversation history');
    expect(warning).toContain('other users');
    expect(warning).not.toContain('All messages in this channel');
    expect(mockBuildDestructiveWarning).toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('carries ONLY the channelId in entityId; the slug rides the footer', async () => {
    // The slug can reach SLUG_MAX_LENGTH (50) — in the customId it blew
    // Discord's 100-char budget and made setCustomId throw. Keeping the
    // customId payload to the snowflake makes the overflow structurally
    // impossible; the slug travels via the embed footer instead.
    const longSlug = 'a'.repeat(50);
    const context = createMockContext(longSlug, 'channel-456');
    await handlePurgeHistory(context);

    expect(mockCreateHardDeleteConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'channel-456',
        footerText: `slug:${longSlug}`,
      })
    );
  });

  it('should handle exceptions', async () => {
    mockBuildDestructiveWarning.mockImplementation(() => {
      throw new Error('Build error');
    });

    const context = createMockContext();
    await handlePurgeHistory(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Failed to purge history. Please try again.',
    });
  });

  it('rejects the autocomplete-error sentinel before building the warning', async () => {
    const context = createMockContext('__autocomplete_error__');
    await handlePurgeHistory(context);

    expect(mockBuildDestructiveWarning).not.toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
    });
  });
});

describe('parsePurgeSlugFromFooter', () => {
  it('parses the slug out of a well-formed footer', () => {
    expect(parsePurgeSlugFromFooter('slug:lilith')).toBe('lilith');
  });

  it('handles complex slugs, including ones containing colons after the prefix', () => {
    expect(parsePurgeSlugFromFooter('slug:my-custom-personality')).toBe('my-custom-personality');
    expect(parsePurgeSlugFromFooter('slug:a:b')).toBe('a:b');
  });

  it('round-trips a maximum-length slug intact', () => {
    const longSlug = 'a'.repeat(50);
    expect(parsePurgeSlugFromFooter(`slug:${longSlug}`)).toBe(longSlug);
  });

  it('returns null for a missing footer (fail closed)', () => {
    expect(parsePurgeSlugFromFooter(undefined)).toBeNull();
  });

  it('returns null for a footer without the slug prefix', () => {
    expect(parsePurgeSlugFromFooter('lilith')).toBeNull();
  });

  it('returns null for an empty slug after the prefix', () => {
    expect(parsePurgeSlugFromFooter('slug:')).toBeNull();
  });
});
