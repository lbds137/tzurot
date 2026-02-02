/**
 * Tests for Subcommand Router Utility
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  createSubcommandRouter,
  replyUnknownSubcommand,
  replyUnknownAction,
} from './subcommandRouter.js';

describe('subcommandRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(subcommand: string) {
    return {
      user: { id: 'user-123' },
      options: {
        getSubcommand: vi.fn().mockReturnValue(subcommand),
      },
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<ReturnType<typeof createSubcommandRouter>>[0];
  }

  function createMockLogger() {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  describe('createSubcommandRouter', () => {
    it('should route to correct handler', async () => {
      const mockHandler = vi.fn().mockResolvedValue(undefined);
      const router = createSubcommandRouter({
        test: mockHandler,
      });

      const interaction = createMockInteraction('test');
      await router(interaction);

      expect(mockHandler).toHaveBeenCalledWith(interaction);
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should reply with unknown subcommand for unregistered subcommand', async () => {
      const router = createSubcommandRouter({
        known: vi.fn(),
      });

      const interaction = createMockInteraction('unknown');
      await router(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '\u274c Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should log subcommand execution when logger provided', async () => {
      const mockLogger = createMockLogger();
      const mockHandler = vi.fn().mockResolvedValue(undefined);
      const router = createSubcommandRouter(
        { test: mockHandler },
        {
          logger: mockLogger as unknown as NonNullable<
            Parameters<typeof createSubcommandRouter>[1]
          >['logger'],
          logPrefix: '[Test]',
        }
      );

      const interaction = createMockInteraction('test');
      await router(interaction);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { subcommand: 'test', userId: 'user-123' },
        '[Test] Executing subcommand'
      );
    });

    it('should not log when no logger provided', async () => {
      const mockHandler = vi.fn().mockResolvedValue(undefined);
      const router = createSubcommandRouter({ test: mockHandler });

      const interaction = createMockInteraction('test');
      await router(interaction);

      // No error thrown, handler called
      expect(mockHandler).toHaveBeenCalled();
    });

    it('should support multiple handlers', async () => {
      const handlers = {
        set: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      const router = createSubcommandRouter(handlers);

      // Test each handler
      await router(createMockInteraction('set'));
      expect(handlers.set).toHaveBeenCalled();
      expect(handlers.list).not.toHaveBeenCalled();

      await router(createMockInteraction('list'));
      expect(handlers.list).toHaveBeenCalled();

      await router(createMockInteraction('remove'));
      expect(handlers.remove).toHaveBeenCalled();
    });

    it('should propagate handler errors', async () => {
      const error = new Error('Handler failed');
      const router = createSubcommandRouter({
        failing: vi.fn().mockRejectedValue(error),
      });

      const interaction = createMockInteraction('failing');
      await expect(router(interaction)).rejects.toThrow('Handler failed');
    });
  });

  describe('replyUnknownSubcommand', () => {
    it('should reply with ephemeral error message', async () => {
      const interaction = createMockInteraction('any');
      await replyUnknownSubcommand(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '\u274c Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe('replyUnknownAction', () => {
    it('should reply with ephemeral error message', async () => {
      const interaction = {
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as Parameters<typeof replyUnknownAction>[0];

      await replyUnknownAction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '\u274c Unknown action',
        flags: MessageFlags.Ephemeral,
      });
    });
  });
});
