/**
 * Tests for Preset Command Autocomplete Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAutocomplete } from './autocomplete.js';
import type { AutocompleteInteraction, User } from 'discord.js';
import { mockListLlmConfigsResponse, mockLlmConfigSummary } from '@tzurot/common-types';

// Mock logger - use importOriginal pattern for async mock factories
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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
      commandName: 'preset',
      options: {
        getFocused: vi.fn(),
        getSubcommand: vi.fn().mockReturnValue('delete'),
        getSubcommandGroup: vi.fn().mockReturnValue(null),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    } as unknown as AutocompleteInteraction;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('preset autocomplete', () => {
    it('should respond with filtered user-owned presets only', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: mockListLlmConfigsResponse([
          mockLlmConfigSummary({
            id: 'c1',
            name: 'My Preset',
            model: 'anthropic/claude-sonnet-4',
            isGlobal: false,
            isOwned: true,
          }),
          mockLlmConfigSummary({
            id: 'c2',
            name: 'Global Preset',
            model: 'openai/gpt-4',
            isGlobal: true,
            isOwned: false,
          }),
        ]),
      });

      await handleAutocomplete(mockInteraction);

      expect(callGatewayApi).toHaveBeenCalledWith('/user/llm-config', { userId: 'user-123' });
      // Should only return owned presets
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'My Preset · claude-sonnet-4', value: 'c1' },
      ]);
    });

    it('should filter by preset name', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'fast',
      } as unknown as string);
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: mockListLlmConfigsResponse([
          mockLlmConfigSummary({
            id: 'c1',
            name: 'Fast Preset',
            model: 'anthropic/claude-sonnet-4',
            isGlobal: false,
            isOwned: true,
          }),
          mockLlmConfigSummary({
            id: 'c2',
            name: 'Slow Preset',
            model: 'openai/gpt-4',
            isGlobal: false,
            isOwned: true,
          }),
        ]),
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Fast Preset · claude-sonnet-4', value: 'c1' },
      ]);
    });

    it('should filter by model name', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'gpt',
      } as unknown as string);
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: mockListLlmConfigsResponse([
          mockLlmConfigSummary({
            id: 'c1',
            name: 'Claude Preset',
            model: 'anthropic/claude-sonnet-4',
            isGlobal: false,
            isOwned: true,
          }),
          mockLlmConfigSummary({
            id: 'c2',
            name: 'GPT Preset',
            model: 'openai/gpt-4',
            isGlobal: false,
            isOwned: true,
          }),
        ]),
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'GPT Preset · gpt-4', value: 'c2' },
      ]);
    });

    it('should filter by description', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'cheap',
      } as unknown as string);
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: mockListLlmConfigsResponse([
          mockLlmConfigSummary({
            id: 'c1',
            name: 'Preset A',
            description: 'Fast and cheap',
            model: 'anthropic/claude-sonnet-4',
            isGlobal: false,
            isOwned: true,
          }),
          mockLlmConfigSummary({
            id: 'c2',
            name: 'Preset B',
            description: 'Expensive but good',
            model: 'openai/gpt-4',
            isGlobal: false,
            isOwned: true,
          }),
        ]),
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Preset A · claude-sonnet-4', value: 'c1' },
      ]);
    });

    it('should respond with empty array on API error', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'test',
      } as unknown as string);
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
        name: 'preset',
        value: '',
      } as unknown as string);
      const manyPresets = Array.from({ length: 30 }, (_, i) =>
        mockLlmConfigSummary({
          id: `c${i}`,
          name: `Preset${i}`,
          model: `provider/model${i}`,
          isGlobal: false,
          isOwned: true,
        })
      );
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: { configs: manyPresets },
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
      } as unknown as string);

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });

  describe('error handling', () => {
    it('should respond with empty array on exception', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'test',
      } as unknown as string);
      vi.mocked(callGatewayApi).mockRejectedValue(new Error('Network error'));

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });
});
