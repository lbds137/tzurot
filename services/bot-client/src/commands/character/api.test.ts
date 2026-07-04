/**
 * Tests for Character API Client Functions
 *
 * Verifies that the typed `userClient` is called correctly and the
 * response is shaped into bot-client `CharacterData` (including the
 * `characterInfo`/`personalityTraits` nullable→empty-string coercion
 * and `avatarData: null` default — see `api.ts:toCharacterData` for
 * the divergence rationale).
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
  toCharacterData,
} from './api.js';
import type { EnvConfig } from '@tzurot/common-types/config/config';
import type { UserClient } from '@tzurot/clients';

interface StubUserClient {
  getPersonality: ReturnType<typeof vi.fn>;
  listPersonalities: ReturnType<typeof vi.fn>;
  createPersonality: ReturnType<typeof vi.fn>;
  updatePersonality: ReturnType<typeof vi.fn>;
  setPersonalityVisibility: ReturnType<typeof vi.fn>;
}

function makeStub(): StubUserClient {
  return {
    getPersonality: vi.fn(),
    listPersonalities: vi.fn(),
    createPersonality: vi.fn(),
    updatePersonality: vi.fn(),
    setPersonalityVisibility: vi.fn(),
  };
}

function asClient(stub: StubUserClient): UserClient {
  return stub as unknown as UserClient;
}

/**
 * Build a minimal `PersonalityFull`-shaped object with sensible defaults.
 * Tests can override fields they care about.
 */
function makePersonality(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'char-uuid-1',
    name: 'Test Character',
    slug: 'test-character',
    displayName: 'Test Display',
    characterInfo: 'Info',
    personalityTraits: 'Traits',
    personalityTone: null,
    personalityAge: null,
    personalityAppearance: null,
    personalityLikes: null,
    personalityDislikes: null,
    conversationalGoals: null,
    conversationalExamples: null,
    errorMessage: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    isPublic: false,
    voiceEnabled: false,
    imageEnabled: false,
    ownerId: 'owner-uuid-1',
    hasAvatar: false,
    hasVoiceReference: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Character API Client', () => {
  const mockConfig = {
    GATEWAY_URL: 'http://localhost:3000',
  } as EnvConfig;

  let stub: StubUserClient;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Pure unit tests for the schema/local-type bridge. The fixtures used by
  // the API-helper tests below always provide non-null `characterInfo` /
  // `personalityTraits` and never assert `avatarData`, so the load-bearing
  // null-coercion behavior would otherwise be untested.
  describe('toCharacterData', () => {
    it('coerces null characterInfo and personalityTraits to empty string', () => {
      const result = toCharacterData({
        characterInfo: null,
        personalityTraits: null,
      });
      expect(result.characterInfo).toBe('');
      expect(result.personalityTraits).toBe('');
    });

    it('preserves non-null values', () => {
      const result = toCharacterData({
        characterInfo: 'Bio',
        personalityTraits: 'Calm',
      });
      expect(result.characterInfo).toBe('Bio');
      expect(result.personalityTraits).toBe('Calm');
    });

    it('always sets avatarData to null regardless of input', () => {
      const result = toCharacterData({
        characterInfo: 'X',
        personalityTraits: 'Y',
      });
      expect(result.avatarData).toBeNull();
    });

    it('preserves additional schema fields like hasAvatar untouched', () => {
      const result = toCharacterData({
        characterInfo: null,
        personalityTraits: null,
        hasAvatar: true,
        slug: 'test',
      });
      expect(result.hasAvatar).toBe(true);
      expect(result.slug).toBe('test');
    });
  });

  describe('fetchCharacter', () => {
    it('should fetch character and include canEdit from API response', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: {
          personality: makePersonality({ slug: 'test-character' }),
          canEdit: true,
        },
      });

      const result = await fetchCharacter('test-character', mockConfig, asClient(stub));

      expect(stub.getPersonality).toHaveBeenCalledWith('test-character');
      expect(result).not.toBeNull();
      expect(result!.slug).toBe('test-character');
      expect(result!.canEdit).toBe(true);
    });

    it('should return canEdit false when user does not own character', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: {
          personality: makePersonality({
            slug: 'other-character',
            isPublic: true,
            ownerId: 'other-owner-uuid',
          }),
          canEdit: false,
        },
      });

      const result = await fetchCharacter('other-character', mockConfig, asClient(stub));

      expect(result!.canEdit).toBe(false);
    });

    it('should return null for 404 response', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Not found',
      });

      const result = await fetchCharacter('nonexistent', mockConfig, asClient(stub));

      expect(result).toBeNull();
    });

    it('should return null for 403 response', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: false,
        status: 403,
        error: 'Forbidden',
      });

      const result = await fetchCharacter('private-char', mockConfig, asClient(stub));

      expect(result).toBeNull();
    });

    it('should throw error for other error statuses', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Internal server error',
      });

      await expect(fetchCharacter('test', mockConfig, asClient(stub))).rejects.toThrow(
        'Failed to fetch character: 500'
      );
    });
  });

  describe('fetchAllCharacters', () => {
    it('should separate owned and public characters', async () => {
      stub.listPersonalities.mockResolvedValue({
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
              ownerDiscordId: 'discord-user-123',
              permissions: { canEdit: true, canDelete: true },
            },
            {
              id: 'char-2',
              name: 'Other Char',
              slug: 'other-char',
              displayName: 'Display Name',
              isOwned: false,
              isPublic: true,
              ownerId: 'owner-2',
              ownerDiscordId: 'other-discord-id',
              permissions: { canEdit: false, canDelete: false },
            },
          ],
        },
      });

      const result = await fetchAllCharacters(asClient(stub), mockConfig);

      expect(result.owned).toHaveLength(1);
      expect(result.owned[0].slug).toBe('my-char');

      expect(result.publicOthers).toHaveLength(1);
      expect(result.publicOthers[0].slug).toBe('other-char');
    });

    it('should throw error on API failure', async () => {
      stub.listPersonalities.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      await expect(fetchAllCharacters(asClient(stub), mockConfig)).rejects.toThrow(
        'Failed to fetch characters: 500'
      );
    });
  });

  describe('fetchUserCharacters', () => {
    it('should return only owned characters', async () => {
      stub.listPersonalities.mockResolvedValue({
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
              ownerDiscordId: 'discord-user-123',
              permissions: { canEdit: true, canDelete: true },
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
              permissions: { canEdit: false, canDelete: false },
            },
          ],
        },
      });

      const result = await fetchUserCharacters(asClient(stub), mockConfig);

      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('my-char');
    });
  });

  describe('fetchPublicCharacters', () => {
    it('should return only public characters from others', async () => {
      stub.listPersonalities.mockResolvedValue({
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
              ownerDiscordId: 'discord-user-123',
              permissions: { canEdit: true, canDelete: true },
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
              permissions: { canEdit: false, canDelete: false },
            },
          ],
        },
      });

      const result = await fetchPublicCharacters(asClient(stub), mockConfig);

      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('other-char');
    });
  });

  describe('createCharacter', () => {
    it('should create character via API', async () => {
      stub.createPersonality.mockResolvedValue({
        ok: true,
        data: {
          success: true,
          personality: makePersonality({
            id: 'new-char-uuid',
            name: 'New Character',
            slug: 'new-character',
          }),
        },
      });

      const input = {
        name: 'New Character',
        slug: 'new-character',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      };
      const result = await createCharacter(input, asClient(stub), mockConfig);

      expect(stub.createPersonality).toHaveBeenCalledWith(input);
      expect(result.slug).toBe('new-character');
    });

    it('should throw error on creation failure', async () => {
      stub.createPersonality.mockResolvedValue({
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
          asClient(stub),
          mockConfig
        )
      ).rejects.toThrow('Failed to create character: 409 - Slug already exists');
    });
  });

  describe('updateCharacter', () => {
    it('should update character via API', async () => {
      stub.updatePersonality.mockResolvedValue({
        ok: true,
        data: {
          success: true,
          personality: makePersonality({ name: 'Updated Name', slug: 'test-char' }),
        },
      });

      const result = await updateCharacter(
        'test-char',
        { name: 'Updated Name' },
        asClient(stub),
        mockConfig
      );

      expect(stub.updatePersonality).toHaveBeenCalledWith('test-char', { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
    });

    it('should throw error on update failure', async () => {
      stub.updatePersonality.mockResolvedValue({
        ok: false,
        status: 403,
        error: 'Not authorized',
      });

      await expect(
        updateCharacter('test-char', { name: 'New Name' }, asClient(stub), mockConfig)
      ).rejects.toThrow('Failed to update character: 403 - Not authorized');
    });

    it('strips empty characterInfo/personalityTraits before the PUT', async () => {
      // A legacy character whose required text comes back null is coerced to ''
      // by toCharacterData and replayed on every section save; the update schema
      // rejects '' (min(1)), so updateCharacter must drop them — while preserving
      // the section the user actually changed.
      stub.updatePersonality.mockResolvedValue({
        ok: true,
        data: { success: true, personality: makePersonality({ slug: 'test-char' }) },
      });

      await updateCharacter(
        'test-char',
        { characterInfo: '', personalityTraits: '', personalityTone: 'Wry' },
        asClient(stub),
        mockConfig
      );

      expect(stub.updatePersonality).toHaveBeenCalledWith('test-char', { personalityTone: 'Wry' });
    });
  });

  describe('toggleVisibility', () => {
    it('should toggle visibility via API', async () => {
      stub.setPersonalityVisibility.mockResolvedValue({
        ok: true,
        data: {
          success: true,
          personality: {
            id: 'char-uuid',
            slug: 'test-char',
            isPublic: true,
          },
        },
      });

      const result = await toggleVisibility('test-char', true, asClient(stub), mockConfig);

      expect(stub.setPersonalityVisibility).toHaveBeenCalledWith('test-char', { isPublic: true });
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
