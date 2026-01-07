/**
 * Tests for Safe Interaction Wrapper
 *
 * Verifies that wrapDeferredInteraction correctly converts reply() calls
 * to editReply() calls for deferred interactions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction, Message } from 'discord.js';

// Mock the logger using vi.hoisted to ensure proper initialization order
const { mockWarn } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: mockWarn,
      error: vi.fn(),
    }),
  };
});

// Import after mock setup
import { wrapDeferredInteraction } from './safeInteraction.js';

describe('wrapDeferredInteraction', () => {
  let mockInteraction: ChatInputCommandInteraction;
  let mockMessage: Message;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessage = { id: 'msg-123', content: 'test' } as Message;

    mockInteraction = {
      reply: vi.fn().mockResolvedValue(mockMessage),
      editReply: vi.fn().mockResolvedValue(mockMessage),
      followUp: vi.fn().mockResolvedValue(mockMessage),
      deferReply: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-123' },
      commandName: 'test',
      options: {
        getSubcommand: vi.fn().mockReturnValue(null),
        getSubcommandGroup: vi.fn().mockReturnValue(null),
      },
      deferred: true,
      replied: false,
    } as unknown as ChatInputCommandInteraction;
  });

  describe('reply() interception', () => {
    it('should convert reply() calls to editReply() for string content', async () => {
      const wrapped = wrapDeferredInteraction(mockInteraction);

      await wrapped.reply('Hello world');

      expect(mockInteraction.editReply).toHaveBeenCalledWith('Hello world');
      expect(mockInteraction.reply).not.toHaveBeenCalled();
    });

    it('should convert reply() calls to editReply() for object options', async () => {
      const wrapped = wrapDeferredInteraction(mockInteraction);
      const options = { content: 'Hello', embeds: [] };

      await wrapped.reply(options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(options);
      expect(mockInteraction.reply).not.toHaveBeenCalled();
    });

    it('should pass through ephemeral flag (already set by deferReply)', async () => {
      const wrapped = wrapDeferredInteraction(mockInteraction);
      const options = { content: 'Secret', flags: 64 }; // Ephemeral flag

      await wrapped.reply(options);

      // The flag is passed through (it's a no-op since deferReply already set ephemerality)
      expect(mockInteraction.editReply).toHaveBeenCalledWith(options);
    });

    it('should return the message from editReply()', async () => {
      const wrapped = wrapDeferredInteraction(mockInteraction);

      const result = await wrapped.reply('test');

      expect(result).toBe(mockMessage);
    });
  });

  describe('other methods', () => {
    it('should not intercept editReply() calls', async () => {
      const wrapped = wrapDeferredInteraction(mockInteraction);

      await wrapped.editReply('Hello world');

      expect(mockInteraction.editReply).toHaveBeenCalledWith('Hello world');
    });

    it('should not intercept followUp() calls', async () => {
      const wrapped = wrapDeferredInteraction(mockInteraction);

      await wrapped.followUp('Follow up message');

      expect(mockInteraction.followUp).toHaveBeenCalledWith('Follow up message');
    });
  });

  describe('property access', () => {
    it('should preserve access to interaction properties', () => {
      const wrapped = wrapDeferredInteraction(mockInteraction);

      expect(wrapped.user.id).toBe('user-123');
      expect(wrapped.commandName).toBe('test');
      expect(wrapped.deferred).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle reply() with files attachment', async () => {
      const wrapped = wrapDeferredInteraction(mockInteraction);
      const options = {
        content: 'Here is a file',
        files: [{ attachment: Buffer.from('test'), name: 'test.txt' }],
      };

      await wrapped.reply(options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(options);
    });

    it('should handle reply() with embeds', async () => {
      const wrapped = wrapDeferredInteraction(mockInteraction);
      const options = {
        embeds: [{ title: 'Test Embed', description: 'Test' }],
      };

      await wrapped.reply(options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(options);
    });
  });

  describe('logging', () => {
    it('should log a warning when reply() is intercepted', async () => {
      const wrapped = wrapDeferredInteraction(mockInteraction);

      await wrapped.reply('Hello world');

      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'test' }),
        expect.stringContaining('Command used reply() on deferred interaction')
      );
    });

    it('should include full command name with subcommand in log', async () => {
      // Mock a command with subcommand
      (mockInteraction.options.getSubcommand as ReturnType<typeof vi.fn>).mockReturnValue(
        'template'
      );
      mockInteraction.commandName = 'character';

      const wrapped = wrapDeferredInteraction(mockInteraction);
      await wrapped.reply('test');

      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'character template' }),
        expect.stringContaining('FIX: Change interaction.reply() to interaction.editReply()')
      );
    });

    it('should include full command name with subcommand group in log', async () => {
      // Mock a command with subcommand group and subcommand
      (mockInteraction.options.getSubcommandGroup as ReturnType<typeof vi.fn>).mockReturnValue(
        'profile'
      );
      (mockInteraction.options.getSubcommand as ReturnType<typeof vi.fn>).mockReturnValue('view');
      mockInteraction.commandName = 'me';

      const wrapped = wrapDeferredInteraction(mockInteraction);
      await wrapped.reply('test');

      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'me profile view' }),
        expect.any(String)
      );
    });
  });
});
