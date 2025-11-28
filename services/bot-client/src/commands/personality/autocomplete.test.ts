/**
 * Tests for Personality Command Autocomplete Handler
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
      commandName: 'personality',
      options: {
        getFocused: vi.fn(),
        getSubcommand: vi.fn().mockReturnValue('edit'),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    } as unknown as AutocompleteInteraction;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('slug autocomplete', () => {
    it('should respond with filtered user-owned personalities only', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'slug',
        value: '',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          personalities: [
            {
              id: 'p1',
              name: 'My Personality',
              displayName: 'Display Name',
              slug: 'my-personality',
              isOwned: true,
            },
            {
              id: 'p2',
              name: 'Public Personality',
              displayName: null,
              slug: 'public-personality',
              isOwned: false,
            },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(callGatewayApi).toHaveBeenCalledWith('/user/personality', { userId: 'user-123' });
      // Should only return owned personalities with slug as value
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Display Name', value: 'my-personality' },
      ]);
    });

    it('should use name when displayName is null', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'slug',
        value: '',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          personalities: [
            {
              id: 'p1',
              name: 'Internal Name',
              displayName: null,
              slug: 'internal-name',
              isOwned: true,
            },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Internal Name', value: 'internal-name' },
      ]);
    });

    it('should filter by personality name', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'slug',
        value: 'alice',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          personalities: [
            {
              id: 'p1',
              name: 'Alice',
              displayName: null,
              slug: 'alice',
              isOwned: true,
            },
            {
              id: 'p2',
              name: 'Bob',
              displayName: null,
              slug: 'bob',
              isOwned: true,
            },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([{ name: 'Alice', value: 'alice' }]);
    });

    it('should filter by slug', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'slug',
        value: 'my-custom',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          personalities: [
            {
              id: 'p1',
              name: 'Test Bot',
              displayName: null,
              slug: 'my-custom-bot',
              isOwned: true,
            },
            {
              id: 'p2',
              name: 'Other Bot',
              displayName: null,
              slug: 'other-bot',
              isOwned: true,
            },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Test Bot', value: 'my-custom-bot' },
      ]);
    });

    it('should filter by displayName', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'slug',
        value: 'demon',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          personalities: [
            {
              id: 'p1',
              name: 'Lilith',
              displayName: 'Demon Queen',
              slug: 'lilith',
              isOwned: true,
            },
            {
              id: 'p2',
              name: 'Angel',
              displayName: 'Divine Being',
              slug: 'angel',
              isOwned: true,
            },
          ],
        },
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Demon Queen', value: 'lilith' },
      ]);
    });

    it('should respond with empty array on API error', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'slug',
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
        name: 'slug',
        value: '',
      });
      const manyPersonalities = Array.from({ length: 30 }, (_, i) => ({
        id: `p${i}`,
        name: `Personality${i}`,
        displayName: null,
        slug: `personality-${i}`,
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
        name: 'slug',
        value: 'test',
      });
      vi.mocked(callGatewayApi).mockRejectedValue(new Error('Network error'));

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });
});
