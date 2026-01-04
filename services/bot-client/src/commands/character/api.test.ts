/**
 * Tests for Character API Client Functions
 *
 * These tests verify the API client functions properly:
 * 1. Handle authentication via callGatewayApi
 * 2. Process responses correctly
 * 3. Return canEdit flag from server-side permission checks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchCharacter,
  fetchAllCharacters,
  fetchUserCharacters,
  fetchPublicCharacters,
  createCharacter,
  updateCharacter,
  toggleVisibility,
  fetchUsernames,
  type FetchedCharacter,
} from './api.js';
import * as userGatewayClient from '../../utils/userGatewayClient.js';
import type { EnvConfig } from '@tzurot/common-types';

// Mock the gateway client
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

describe('Character API Client', () => {
  const mockConfig = {
    GATEWAY_URL: 'http://localhost:3000',
  } as EnvConfig;

  const mockUserId = 'discord-user-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchCharacter', () => {
    it('should fetch character and include canEdit from API response', async () => {
      const mockResponse = {
        ok: true,
        data: {
          personality: {
            id: 'char-uuid-1',
            name: 'Test Character',
            slug: 'test-character',
            displayName: 'Test Display',
            isPublic: false,
            ownerId: 'owner-uuid-1',
          },
          canEdit: true,
        },
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue(mockResponse);

      const result = await fetchCharacter('test-character', mockConfig, mockUserId);

      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith(
        '/user/personality/test-character',
        { userId: mockUserId }
      );

      expect(result).not.toBeNull();
      expect(result!.slug).toBe('test-character');
      expect(result!.canEdit).toBe(true);
    });

    it('should return canEdit false when user does not own character', async () => {
      const mockResponse = {
        ok: true,
        data: {
          personality: {
            id: 'char-uuid-1',
            name: 'Other Character',
            slug: 'other-character',
            isPublic: true,
            ownerId: 'other-owner-uuid',
          },
          canEdit: false,
        },
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue(mockResponse);

      const result = await fetchCharacter('other-character', mockConfig, mockUserId);

      expect(result!.canEdit).toBe(false);
    });

    it('should return null for 404 response', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Not found',
      });

      const result = await fetchCharacter('nonexistent', mockConfig, mockUserId);

      expect(result).toBeNull();
    });

    it('should return null for 403 response', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 403,
        error: 'Forbidden',
      });

      const result = await fetchCharacter('private-char', mockConfig, mockUserId);

      expect(result).toBeNull();
    });

    it('should throw error for other error statuses', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Internal server error',
      });

      await expect(fetchCharacter('test', mockConfig, mockUserId)).rejects.toThrow(
        'Failed to fetch character: 500'
      );
    });
  });

  describe('fetchAllCharacters', () => {
    it('should separate owned and public characters', async () => {
      const mockResponse = {
        ok: true,
        data: {
          personalities: [
            {
              id: 'char-1',
              name: 'My Char',
              slug: 'my-char',
              displayName: null,
              isOwned: true,
              isPublic: false,
              ownerId: 'owner-1',
              ownerDiscordId: 'discord-user-123', // Matches mockUserId - should be in "owned"
            },
            {
              id: 'char-2',
              name: 'Other Char',
              slug: 'other-char',
              displayName: 'Display Name',
              isOwned: false,
              isPublic: true,
              ownerId: 'owner-2',
              ownerDiscordId: 'other-discord-id', // Different - should be in "publicOthers"
            },
          ],
        },
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue(mockResponse);

      const result = await fetchAllCharacters(mockUserId, mockConfig);

      expect(result.owned).toHaveLength(1);
      expect(result.owned[0].slug).toBe('my-char');

      expect(result.publicOthers).toHaveLength(1);
      expect(result.publicOthers[0].slug).toBe('other-char');
    });

    it('should throw error on API failure', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      await expect(fetchAllCharacters(mockUserId, mockConfig)).rejects.toThrow(
        'Failed to fetch characters: 500'
      );
    });
  });

  describe('fetchUserCharacters', () => {
    it('should return only owned characters', async () => {
      const mockResponse = {
        ok: true,
        data: {
          personalities: [
            {
              id: 'char-1',
              name: 'My Char',
              slug: 'my-char',
              displayName: null,
              isOwned: true,
              isPublic: false,
              ownerId: 'owner-1',
              ownerDiscordId: 'discord-user-123', // Matches mockUserId
            },
            {
              id: 'char-2',
              name: 'Other Char',
              slug: 'other-char',
              displayName: null,
              isOwned: false,
              isPublic: true,
              ownerId: 'owner-2',
              ownerDiscordId: 'other-discord-id',
            },
          ],
        },
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue(mockResponse);

      const result = await fetchUserCharacters(mockUserId, mockConfig);

      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('my-char');
    });
  });

  describe('fetchPublicCharacters', () => {
    it('should return only public characters from others', async () => {
      const mockResponse = {
        ok: true,
        data: {
          personalities: [
            {
              id: 'char-1',
              name: 'My Char',
              slug: 'my-char',
              displayName: null,
              isOwned: true,
              isPublic: false,
              ownerId: 'owner-1',
              ownerDiscordId: 'discord-user-123', // Matches mockUserId - should be in "owned"
            },
            {
              id: 'char-2',
              name: 'Other Char',
              slug: 'other-char',
              displayName: null,
              isOwned: false,
              isPublic: true,
              ownerId: 'owner-2',
              ownerDiscordId: 'other-discord-id', // Different - should be in "publicOthers"
            },
          ],
        },
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue(mockResponse);

      const result = await fetchPublicCharacters(mockUserId, mockConfig);

      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('other-char');
    });
  });

  describe('createCharacter', () => {
    it('should create character via API', async () => {
      const mockResponse = {
        ok: true,
        data: {
          success: true,
          personality: {
            id: 'new-char-uuid',
            name: 'New Character',
            slug: 'new-character',
            characterInfo: 'Info',
            personalityTraits: 'Traits',
            isPublic: false,
          },
        },
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue(mockResponse);

      const result = await createCharacter(
        {
          name: 'New Character',
          slug: 'new-character',
          characterInfo: 'Info',
          personalityTraits: 'Traits',
        },
        mockUserId,
        mockConfig
      );

      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith('/user/personality', {
        method: 'POST',
        userId: mockUserId,
        body: {
          name: 'New Character',
          slug: 'new-character',
          characterInfo: 'Info',
          personalityTraits: 'Traits',
        },
      });

      expect(result.slug).toBe('new-character');
    });

    it('should throw error on creation failure', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 409,
        error: 'Slug already exists',
      });

      await expect(
        createCharacter(
          {
            name: 'Test',
            slug: 'existing-slug',
            characterInfo: 'Info',
            personalityTraits: 'Traits',
          },
          mockUserId,
          mockConfig
        )
      ).rejects.toThrow('Failed to create character: 409 - Slug already exists');
    });
  });

  describe('updateCharacter', () => {
    it('should update character via API', async () => {
      const mockResponse = {
        ok: true,
        data: {
          success: true,
          personality: {
            id: 'char-uuid',
            name: 'Updated Name',
            slug: 'test-char',
          },
        },
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue(mockResponse);

      const result = await updateCharacter(
        'test-char',
        { name: 'Updated Name' },
        mockUserId,
        mockConfig
      );

      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith('/user/personality/test-char', {
        method: 'PUT',
        userId: mockUserId,
        body: { name: 'Updated Name' },
      });

      expect(result.name).toBe('Updated Name');
    });

    it('should throw error on update failure', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 403,
        error: 'Not authorized',
      });

      await expect(
        updateCharacter('test-char', { name: 'New Name' }, mockUserId, mockConfig)
      ).rejects.toThrow('Failed to update character: 403 - Not authorized');
    });
  });

  describe('toggleVisibility', () => {
    it('should toggle visibility via API', async () => {
      const mockResponse = {
        ok: true,
        data: {
          success: true,
          personality: {
            id: 'char-uuid',
            slug: 'test-char',
            isPublic: true,
          },
        },
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue(mockResponse);

      const result = await toggleVisibility('test-char', true, mockUserId, mockConfig);

      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith(
        '/user/personality/test-char/visibility',
        {
          method: 'PATCH',
          userId: mockUserId,
          body: { isPublic: true },
        }
      );

      expect(result.isPublic).toBe(true);
    });
  });

  describe('fetchUsernames', () => {
    it('should fetch Discord usernames for user IDs', async () => {
      const mockClient = {
        users: {
          fetch: vi
            .fn()
            .mockResolvedValueOnce({ displayName: 'User One', username: 'userone' })
            .mockResolvedValueOnce({ displayName: null, username: 'usertwo' }),
        },
      } as unknown as Parameters<typeof fetchUsernames>[0];

      const result = await fetchUsernames(mockClient, ['user-1', 'user-2']);

      expect(result.get('user-1')).toBe('User One');
      expect(result.get('user-2')).toBe('usertwo');
    });

    it('should handle fetch failures gracefully', async () => {
      const mockClient = {
        users: {
          fetch: vi.fn().mockRejectedValue(new Error('Unknown user')),
        },
      } as unknown as Parameters<typeof fetchUsernames>[0];

      const result = await fetchUsernames(mockClient, ['unknown-user']);

      expect(result.get('unknown-user')).toBe('Unknown');
    });
  });
});
