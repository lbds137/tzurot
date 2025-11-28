/**
 * Tests for LLM Config Command Autocomplete Handler
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
      options: {
        getFocused: vi.fn(),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    } as unknown as AutocompleteInteraction;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('config autocomplete', () => {
    it('should respond with filtered user-owned configs only', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'config',
        value: '',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          configs: [
            {
              id: 'c1',
              name: 'My Config',
              description: null,
              model: 'anthropic/claude-sonnet-4',
              isGlobal: false,
              isOwned: true,
            },
            {
              id: 'c2',
              name: 'Global Config',
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
      // Should only return owned configs
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'My Config (claude-sonnet-4)', value: 'c1' },
      ]);
    });

    it('should filter by config name', async () => {
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
              name: 'Fast Config',
              description: null,
              model: 'anthropic/claude-sonnet-4',
              isGlobal: false,
              isOwned: true,
            },
            {
              id: 'c2',
              name: 'Slow Config',
              description: null,
              model: 'openai/gpt-4',
              isGlobal: false,
              isOwned: true,
            },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Fast Config (claude-sonnet-4)', value: 'c1' },
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
              isGlobal: false,
              isOwned: true,
            },
            {
              id: 'c2',
              name: 'GPT Config',
              description: null,
              model: 'openai/gpt-4',
              isGlobal: false,
              isOwned: true,
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
        value: 'cheap',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          configs: [
            {
              id: 'c1',
              name: 'Config A',
              description: 'Fast and cheap',
              model: 'anthropic/claude-sonnet-4',
              isGlobal: false,
              isOwned: true,
            },
            {
              id: 'c2',
              name: 'Config B',
              description: 'Expensive but good',
              model: 'openai/gpt-4',
              isGlobal: false,
              isOwned: true,
            },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Config A (claude-sonnet-4)', value: 'c1' },
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

    it('should limit results to 25', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'config',
        value: '',
      });
      const manyConfigs = Array.from({ length: 30 }, (_, i) => ({
        id: `c${i}`,
        name: `Config${i}`,
        description: null,
        model: `provider/model${i}`,
        isGlobal: false,
        isOwned: true,
      }));
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: { configs: manyConfigs },
      });

      await handleAutocomplete(mockInteraction);

      const respondCall = vi.mocked(mockInteraction.respond).mock.calls[0][0];
      expect(respondCall).toHaveLength(25);
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
        name: 'config',
        value: 'test',
      });
      vi.mocked(callGatewayApi).mockRejectedValue(new Error('Network error'));

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });
});
