/**
 * Tests for Owner Middleware
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { requireBotOwner } from './ownerMiddleware.js';
import * as config from '../config/index.js';

// Mock getConfig
vi.mock('../config/index.js', () => ({
  getConfig: vi.fn(),
}));

// Create mock interaction factory
const createMockInteraction = (userId: string) => ({
  user: {
    id: userId,
  },
  reply: vi.fn().mockResolvedValue(undefined),
});

describe('requireBotOwner', () => {
  let mockInteraction: ReturnType<typeof createMockInteraction>;
  let mockGetConfig: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig = vi.mocked(config.getConfig);
    mockInteraction = createMockInteraction('user-123');
  });

  it('should return false and reply with error when BOT_OWNER_ID is undefined', async () => {
    mockGetConfig.mockReturnValue({
      BOT_OWNER_ID: undefined,
    } as any);

    const result = await requireBotOwner(mockInteraction as unknown as ChatInputCommandInteraction);

    expect(result).toBe(false);
    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: '❌ This command is only available to the bot owner.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should return false and reply with error when BOT_OWNER_ID is null', async () => {
    mockGetConfig.mockReturnValue({
      BOT_OWNER_ID: null,
    } as any);

    const result = await requireBotOwner(mockInteraction as unknown as ChatInputCommandInteraction);

    expect(result).toBe(false);
    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: '❌ This command is only available to the bot owner.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should return false and reply with error when BOT_OWNER_ID is empty string', async () => {
    mockGetConfig.mockReturnValue({
      BOT_OWNER_ID: '',
    } as any);

    const result = await requireBotOwner(mockInteraction as unknown as ChatInputCommandInteraction);

    expect(result).toBe(false);
    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: '❌ This command is only available to the bot owner.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should return false and reply with error when user is not the owner', async () => {
    mockGetConfig.mockReturnValue({
      BOT_OWNER_ID: 'owner-456',
    } as any);

    const result = await requireBotOwner(mockInteraction as unknown as ChatInputCommandInteraction);

    expect(result).toBe(false);
    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: '❌ This command is only available to the bot owner.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should return true when user is the owner', async () => {
    mockGetConfig.mockReturnValue({
      BOT_OWNER_ID: 'user-123',
    } as any);

    const result = await requireBotOwner(mockInteraction as unknown as ChatInputCommandInteraction);

    expect(result).toBe(true);
    expect(mockInteraction.reply).not.toHaveBeenCalled();
  });

  it('should work with ModalSubmitInteraction', async () => {
    mockGetConfig.mockReturnValue({
      BOT_OWNER_ID: 'user-123',
    } as any);

    // ModalSubmitInteraction has the same user property structure
    const result = await requireBotOwner(mockInteraction as unknown as ChatInputCommandInteraction);

    expect(result).toBe(true);
    expect(mockInteraction.reply).not.toHaveBeenCalled();
  });
});
