/**
 * Tests for Model Command Autocomplete Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAutocomplete } from './autocomplete.js';
import type { AutocompleteInteraction, User } from 'discord.js';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock the gateway client
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

import { callGatewayApi } from '../../utils/userGatewayClient.js';

describe('handleAutocomplete', () => {
  let mockInteraction: AutocompleteInteraction;
  let mockUser: User;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUser = {
      id: 'user-123',
    } as User;

    mockInteraction = {
      user: mockUser,
      guildId: 'guild-123',
      commandName: 'model',
      options: {
        getFocused: vi.fn(),
        getSubcommand: vi.fn().mockReturnValue('set'),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    } as unknown as AutocompleteInteraction;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('personality autocomplete', () => {
    it('should respond with filtered personalities', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: 'test',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          personalities: [
            { id: 'p1', name: 'TestBot', displayName: 'Test Bot', slug: 'testbot', isOwned: true },
            { id: 'p2', name: 'OtherBot', displayName: null, slug: 'otherbot', isOwned: false },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(callGatewayApi).toHaveBeenCalledWith('/user/personality', { userId: 'user-123' });
      expect(mockInteraction.respond).toHaveBeenCalledWith([{ name: 'Test Bot', value: 'p1' }]);
    });

    it('should use name when displayName is null', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: '',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          personalities: [
            { id: 'p1', name: 'TestBot', displayName: null, slug: 'testbot', isOwned: true },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([{ name: 'TestBot', value: 'p1' }]);
    });

    it('should filter by slug', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: 'lil',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          personalities: [
            { id: 'p1', name: 'Lilith', displayName: 'Lilith Bot', slug: 'lilith', isOwned: true },
            { id: 'p2', name: 'Other', displayName: 'Other Bot', slug: 'other', isOwned: false },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([{ name: 'Lilith Bot', value: 'p1' }]);
    });

    it('should respond with empty array on API error', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: 'test',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'API error',
        status: 500,
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });

    it('should limit results to 25', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: '',
      });
      const manyPersonalities = Array.from({ length: 30 }, (_, i) => ({
        id: `p${i}`,
        name: `Personality${i}`,
        displayName: null,
        slug: `personality${i}`,
        isOwned: true,
      }));
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: { personalities: manyPersonalities },
      });

      await handleAutocomplete(mockInteraction);

      const respondCall = vi.mocked(mockInteraction.respond).mock.calls[0][0];
      expect(respondCall).toHaveLength(25);
    });
  });

  describe('config autocomplete', () => {
    it('should respond with filtered configs', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'config',
        value: 'claude',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          configs: [
            {
              id: 'c1',
              name: 'Claude Config',
              description: null,
              model: 'anthropic/claude-sonnet-4',
              isGlobal: true,
              isOwned: false,
            },
            {
              id: 'c2',
              name: 'GPT Config',
              description: null,
              model: 'openai/gpt-4',
              isGlobal: true,
              isOwned: false,
            },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(callGatewayApi).toHaveBeenCalledWith('/user/llm-config', { userId: 'user-123' });
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Claude Config (claude-sonnet-4)', value: 'c1' },
      ]);
    });

    it('should filter by model name', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'config',
        value: 'gpt',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          configs: [
            {
              id: 'c1',
              name: 'Claude Config',
              description: null,
              model: 'anthropic/claude-sonnet-4',
              isGlobal: true,
              isOwned: false,
            },
            {
              id: 'c2',
              name: 'GPT Config',
              description: null,
              model: 'openai/gpt-4',
              isGlobal: true,
              isOwned: false,
            },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'GPT Config (gpt-4)', value: 'c2' },
      ]);
    });

    it('should filter by description', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'config',
        value: 'fast',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          configs: [
            {
              id: 'c1',
              name: 'Claude Config',
              description: 'Fast and cheap',
              model: 'anthropic/claude-sonnet-4',
              isGlobal: true,
              isOwned: false,
            },
            {
              id: 'c2',
              name: 'GPT Config',
              description: 'Slow but accurate',
              model: 'openai/gpt-4',
              isGlobal: true,
              isOwned: false,
            },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Claude Config (claude-sonnet-4)', value: 'c1' },
      ]);
    });

    it('should respond with empty array on API error', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'config',
        value: 'test',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'API error',
        status: 500,
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });

  describe('unknown option', () => {
    it('should respond with empty array for unknown option', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'unknown',
        value: 'test',
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });

  describe('error handling', () => {
    it('should respond with empty array on exception', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: 'test',
      });
      vi.mocked(callGatewayApi).mockRejectedValue(new Error('Network error'));

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });
});
