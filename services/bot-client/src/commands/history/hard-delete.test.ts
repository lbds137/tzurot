/**
 * Tests for History Hard-Delete Subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { handleHardDelete, parseHardDeleteEntityId } from './hard-delete.js';

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

// Mock destructiveConfirmation
const mockBuildDestructiveWarning = vi.fn();
const mockCreateHardDeleteConfig = vi.fn(() => ({
  source: 'history',
  operation: 'hard-delete',
  entityId: 'lilith|channel-123',
}));
vi.mock('../../utils/destructiveConfirmation.js', () => ({
  buildDestructiveWarning: (...args: unknown[]) =>
    mockBuildDestructiveWarning(...(args as Parameters<typeof mockBuildDestructiveWarning>)),
  createHardDeleteConfig: (...args: unknown[]) =>
    mockCreateHardDeleteConfig(...(args as Parameters<typeof mockCreateHardDeleteConfig>)),
}));

describe('handleHardDelete', () => {
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
            if (name === 'personality') return personalitySlug;
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
        if (name === 'personality') return personalitySlug;
        throw new Error(`Unknown required option: ${name}`);
      }),
      getSubcommand: () => 'hard-delete',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  it('should show destructive warning with danger button', async () => {
    const context = createMockContext();
    await handleHardDelete(context);

    expect(mockCreateHardDeleteConfig).toHaveBeenCalledWith({
      entityType: 'conversation history',
      entityName: 'lilith',
      additionalWarning: expect.stringContaining('PERMANENT'),
      source: 'history',
      operation: 'hard-delete',
      entityId: 'lilith|channel-123',
    });
    expect(mockBuildDestructiveWarning).toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should include channelId in entityId', async () => {
    const context = createMockContext('test-personality', 'channel-456');
    await handleHardDelete(context);

    expect(mockCreateHardDeleteConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'test-personality|channel-456',
      })
    );
  });

  it('should handle exceptions', async () => {
    mockBuildDestructiveWarning.mockImplementation(() => {
      throw new Error('Build error');
    });

    const context = createMockContext();
    await handleHardDelete(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });
});

describe('parseHardDeleteEntityId', () => {
  it('should parse valid entityId', () => {
    const result = parseHardDeleteEntityId('lilith|channel-123');

    expect(result).toEqual({
      personalitySlug: 'lilith',
      channelId: 'channel-123',
    });
  });

  it('should handle entityId with complex personality slug', () => {
    const result = parseHardDeleteEntityId('my-custom-personality|123456789012345678');

    expect(result).toEqual({
      personalitySlug: 'my-custom-personality',
      channelId: '123456789012345678',
    });
  });

  it('should return null for invalid entityId (no separator)', () => {
    const result = parseHardDeleteEntityId('lilith-channel-123');

    expect(result).toBeNull();
  });

  it('should return null for invalid entityId (too many separators)', () => {
    const result = parseHardDeleteEntityId('lilith|channel|123');

    expect(result).toBeNull();
  });

  it('should return null for empty entityId', () => {
    const result = parseHardDeleteEntityId('');

    expect(result).toBeNull();
  });

  it('should return null for entityId with only separator', () => {
    const result = parseHardDeleteEntityId('|');

    expect(result).toEqual({
      personalitySlug: '',
      channelId: '',
    });
  });

  it('should handle single-part entityId', () => {
    const result = parseHardDeleteEntityId('lilith');

    expect(result).toBeNull();
  });
});
