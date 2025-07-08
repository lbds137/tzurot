/**
 * @jest-environment node
 * @testType domain
 *
 * PersonalityProfile Value Object Test
 * - Pure domain test with no external dependencies
 * - Tests profile creation, updates, and validation
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const { PersonalityProfile } = require('../../../../src/domain/personality/PersonalityProfile');

describe('PersonalityProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // No console mocking needed for pure domain tests
  });

  describe('constructor', () => {
    describe('external mode (legacy/API)', () => {
      it('should create empty external profile', () => {
        const profile = new PersonalityProfile({});

        expect(profile.mode).toBe('external');
        expect(profile.displayName).toBeNull();
        expect(profile.avatarUrl).toBeNull();
        expect(profile.errorMessage).toBeNull();
        expect(profile.lastFetched).toBeNull();
      });

      it('should create external profile with display fields', () => {
        const profile = new PersonalityProfile({
          displayName: 'Claude 3 Opus',
          avatarUrl: 'https://example.com/avatar.png',
          errorMessage: 'Custom error message',
        });

        expect(profile.mode).toBe('external');
        expect(profile.displayName).toBe('Claude 3 Opus');
        expect(profile.avatarUrl).toBe('https://example.com/avatar.png');
        expect(profile.errorMessage).toBe('Custom error message');
        expect(profile.prompt).toBeNull();
        expect(profile.modelPath).toBeNull();
      });

      it('should explicitly create external mode profile', () => {
        const profile = new PersonalityProfile({
          mode: 'external',
          name: 'test-personality',
          displayName: 'Test Personality',
        });

        expect(profile.mode).toBe('external');
        expect(profile.name).toBe('test-personality');
        expect(profile.displayName).toBe('Test Personality');
        expect(profile.prompt).toBeNull();
      });
    });

    describe('local mode (self-managed)', () => {
      it('should create local profile with external API data', () => {
        const profile = new PersonalityProfile({
          mode: 'local',
          username: 'angel-dust',
          name: 'Angel Dust',
          user_prompt: 'Personality prompt here',
          engine_model: 'google/gemini-2.5-pro',
          engine_temperature: 0.8,
          avatar: 'https://example.com/avatar.png',
        });

        expect(profile.mode).toBe('local');
        expect(profile.name).toBe('angel-dust');
        expect(profile.displayName).toBe('Angel Dust');
        expect(profile.prompt).toBe('Personality prompt here');
        expect(profile.modelPath).toBe('google/gemini-2.5-pro');
        expect(profile.temperature).toBe(0.8);
        expect(profile.avatarUrl).toBe('https://example.com/avatar.png');
      });

      it('should auto-detect local mode from user_prompt', () => {
        const profile = new PersonalityProfile({
          user_prompt: 'Test prompt',
          username: 'test-bot',
        });

        expect(profile.mode).toBe('local');
        expect(profile.prompt).toBe('Test prompt');
      });

      it('should handle voice config in local mode', () => {
        const profile = new PersonalityProfile({
          mode: 'local',
          voice_id: 'test-voice-id',
          voice_model: 'eleven_multilingual_v2',
          voice_stability: 0.75,
        });

        expect(profile.voiceConfig).toEqual({
          id: 'test-voice-id',
          model: 'eleven_multilingual_v2',
          stability: 0.75,
        });
      });
    });

    describe('object-only construction requirement', () => {
      it('should throw error for non-object parameter', () => {
        expect(() => new PersonalityProfile('TestName')).toThrow('PersonalityProfile requires an object configuration');
        expect(() => new PersonalityProfile(null)).toThrow('PersonalityProfile requires an object configuration');
        expect(() => new PersonalityProfile(undefined)).toThrow('PersonalityProfile requires an object configuration');
        expect(() => new PersonalityProfile(123)).toThrow('PersonalityProfile requires an object configuration');
      });
    });

    describe('validation', () => {
      it('should validate display name type', () => {
        expect(
          () =>
            new PersonalityProfile({
              displayName: 123,
            })
        ).toThrow('Display name must be a string');
      });

      it('should validate avatar URL type', () => {
        expect(
          () =>
            new PersonalityProfile({
              avatarUrl: true,
            })
        ).toThrow('Avatar URL must be a string');
      });

      it('should validate error message type', () => {
        expect(
          () =>
            new PersonalityProfile({
              errorMessage: {},
            })
        ).toThrow('Error message must be a string');
      });

      it('should validate prompt type', () => {
        expect(
          () =>
            new PersonalityProfile({
              mode: 'local',
              user_prompt: 123,
            })
        ).toThrow('Prompt must be a string');
      });
    });
  });

  describe('withDisplayName', () => {
    it('should create new profile with updated display name', () => {
      const original = new PersonalityProfile({
        displayName: 'Original',
        avatarUrl: 'https://example.com/avatar.png',
      });

      const updated = original.withDisplayName('Updated');

      expect(updated).not.toBe(original); // New instance
      expect(updated.displayName).toBe('Updated');
      expect(updated.avatarUrl).toBe('https://example.com/avatar.png');
      expect(original.displayName).toBe('Original'); // Original unchanged
    });

    it('should preserve other fields', () => {
      const original = new PersonalityProfile({
        displayName: 'Test',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error',
      });

      const updated = original.withDisplayName('New Name');

      expect(updated.avatarUrl).toBe('https://example.com/avatar.png');
      expect(updated.errorMessage).toBe('Error');
    });
  });

  describe('withAvatarUrl', () => {
    it('should create new profile with updated avatar URL', () => {
      const original = new PersonalityProfile({
        displayName: 'Claude',
        avatarUrl: 'https://old.com/avatar.png',
      });

      const updated = original.withAvatarUrl('https://new.com/avatar.png');

      expect(updated).not.toBe(original);
      expect(updated.avatarUrl).toBe('https://new.com/avatar.png');
      expect(updated.displayName).toBe('Claude');
      expect(original.avatarUrl).toBe('https://old.com/avatar.png');
    });
  });

  describe('withErrorMessage', () => {
    it('should create new profile with updated error message', () => {
      const original = new PersonalityProfile({
        displayName: 'Claude',
        errorMessage: 'Old error',
      });

      const updated = original.withErrorMessage('New error');

      expect(updated).not.toBe(original);
      expect(updated.errorMessage).toBe('New error');
      expect(updated.displayName).toBe('Claude');
      expect(original.errorMessage).toBe('Old error');
    });
  });

  describe('isComplete', () => {
    it('should return true when all fields are present', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error message',
      });

      expect(profile.isComplete()).toBe(true);
    });

    it('should return false when missing display name', () => {
      const profile = new PersonalityProfile({
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error message',
      });

      expect(profile.isComplete()).toBe(false);
    });

    it('should return false when missing avatar URL', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude',
        errorMessage: 'Error message',
      });

      expect(profile.isComplete()).toBe(false);
    });

    it('should return false when missing error message', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude',
        avatarUrl: 'https://example.com/avatar.png',
      });

      expect(profile.isComplete()).toBe(false);
    });

    it('should return false for empty profile', () => {
      const profile = PersonalityProfile.createEmpty();

      expect(profile.isComplete()).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize external mode profile', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error message',
      });

      const json = profile.toJSON();
      expect(json).toMatchObject({
        mode: 'external',
        displayName: 'Claude',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error message',
        name: 'Claude',
      });
      expect(json.lastFetched).toBeNull();
      expect(json.prompt).toBeUndefined();
      expect(json.modelPath).toBeUndefined();
    });

    it('should serialize local mode profile', () => {
      const profile = new PersonalityProfile({
        mode: 'local',
        username: 'test-bot',
        name: 'Test Bot',
        user_prompt: 'Test prompt',
        engine_model: 'test/model',
        engine_temperature: 0.8,
        jailbreak: 'Test jailbreak',
        voice_id: 'voice123',
        voice_model: 'eleven_v2',
        voice_stability: 0.5,
      });

      expect(profile.toJSON()).toEqual({
        mode: 'local',
        name: 'test-bot',
        displayName: 'Test Bot',
        avatarUrl: null,
        errorMessage: null,
        prompt: 'Test prompt',
        jailbreak: 'Test jailbreak',
        modelPath: 'test/model',
        maxWordCount: 2000,
        temperature: 0.8,
        voiceConfig: {
          id: 'voice123',
          model: 'eleven_v2',
          stability: 0.5,
        },
      });
    });

    it('should serialize minimal external profile', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude',
      });

      const json = profile.toJSON();
      expect(json).toMatchObject({
        mode: 'external',
        displayName: 'Claude',
        avatarUrl: null,
        errorMessage: null,
        name: 'Claude',
      });
      expect(json.lastFetched).toBeNull();
    });
  });

  describe('createEmpty', () => {
    it('should create profile with all null fields', () => {
      const profile = PersonalityProfile.createEmpty();

      expect(profile).toBeInstanceOf(PersonalityProfile);
      expect(profile.displayName).toBeNull();
      expect(profile.avatarUrl).toBeNull();
      expect(profile.errorMessage).toBeNull();
    });
  });

  describe('fromJSON', () => {
    it('should create profile from JSON data', () => {
      const data = {
        displayName: 'Claude',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error message',
      };

      const profile = PersonalityProfile.fromJSON(data);

      expect(profile).toBeInstanceOf(PersonalityProfile);
      expect(profile.displayName).toBe('Claude');
      expect(profile.avatarUrl).toBe('https://example.com/avatar.png');
      expect(profile.errorMessage).toBe('Error message');
    });

    it('should handle null data', () => {
      const profile = PersonalityProfile.fromJSON(null);

      expect(profile).toBeInstanceOf(PersonalityProfile);
      expect(profile.displayName).toBeNull();
      expect(profile.avatarUrl).toBeNull();
      expect(profile.errorMessage).toBeNull();
    });

    it('should handle undefined data', () => {
      const profile = PersonalityProfile.fromJSON(undefined);

      expect(profile).toBeInstanceOf(PersonalityProfile);
      expect(profile.displayName).toBeNull();
      expect(profile.avatarUrl).toBeNull();
      expect(profile.errorMessage).toBeNull();
    });

    it('should handle partial data', () => {
      const profile = PersonalityProfile.fromJSON({
        displayName: 'Claude',
      });

      expect(profile.displayName).toBe('Claude');
      expect(profile.avatarUrl).toBeNull();
      expect(profile.errorMessage).toBeNull();
    });
  });

  describe('value object equality', () => {
    it('should be equal for same values', () => {
      const profile1 = new PersonalityProfile({
        displayName: 'Claude',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error',
      });

      const profile2 = new PersonalityProfile({
        displayName: 'Claude',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error',
      });

      expect(profile1.equals(profile2)).toBe(true);
    });

    it('should not be equal for different display names', () => {
      const profile1 = new PersonalityProfile({ displayName: 'Claude' });
      const profile2 = new PersonalityProfile({ displayName: 'GPT' });

      expect(profile1.equals(profile2)).toBe(false);
    });

    it('should not be equal for different avatar URLs', () => {
      const profile1 = new PersonalityProfile({ avatarUrl: 'https://a.com/1.png' });
      const profile2 = new PersonalityProfile({ avatarUrl: 'https://a.com/2.png' });

      expect(profile1.equals(profile2)).toBe(false);
    });

    it('should be equal for all null values', () => {
      const profile1 = PersonalityProfile.createEmpty();
      const profile2 = PersonalityProfile.createEmpty();

      expect(profile1.equals(profile2)).toBe(true);
    });
  });

  describe('fromApiResponse', () => {
    it('should create external profile from API response', () => {
      const apiData = {
        name: 'Claude',
        avatar: 'https://api.example.com/avatar.png',
        error_message: 'API error message',
      };

      const profile = PersonalityProfile.fromApiResponse(apiData);

      expect(profile.mode).toBe('external');
      expect(profile.name).toBe('Claude');
      expect(profile.displayName).toBe('Claude');
      expect(profile.avatarUrl).toBe('https://api.example.com/avatar.png');
      expect(profile.errorMessage).toBe('API error message');
      expect(profile.lastFetched).toBeInstanceOf(Date);
    });

    it('should handle alternative field names', () => {
      const apiData = {
        username: 'test-bot',
        name: 'Test Bot Display',
        avatar_url: 'https://alt.example.com/avatar.png',
      };

      const profile = PersonalityProfile.fromApiResponse(apiData);

      expect(profile.name).toBe('test-bot');
      expect(profile.displayName).toBe('Test Bot Display');
      expect(profile.avatarUrl).toBe('https://alt.example.com/avatar.png');
    });
  });

  describe('fromBackupData', () => {
    it('should create local profile from backup data', () => {
      const backupData = {
        username: 'angel-dust',
        name: 'Angel Dust',
        user_prompt: 'Alright sugar...',
        jailbreak: 'I express myself...',
        engine_model: 'google/gemini-2.5-pro',
        engine_temperature: 1.0,
        avatar: 'https://files.example.com/avatar.png',
        voice_id: 'XFS4iF5WnOwpgzpJCvuM',
        voice_model: 'eleven_multilingual_v2',
        voice_stability: 0.53,
      };

      const profile = PersonalityProfile.fromBackupData(backupData);

      expect(profile.mode).toBe('local');
      expect(profile.name).toBe('angel-dust');
      expect(profile.displayName).toBe('Angel Dust');
      expect(profile.prompt).toBe('Alright sugar...');
      expect(profile.jailbreak).toBe('I express myself...');
      expect(profile.modelPath).toBe('google/gemini-2.5-pro');
      expect(profile.temperature).toBe(1.0);
      expect(profile.avatarUrl).toBe('https://files.example.com/avatar.png');
      expect(profile.voiceConfig).toEqual({
        id: 'XFS4iF5WnOwpgzpJCvuM',
        model: 'eleven_multilingual_v2',
        stability: 0.53,
      });
    });
  });

  describe('needsApiRefresh', () => {
    it('should return false for local mode', () => {
      const profile = new PersonalityProfile({
        mode: 'local',
        user_prompt: 'Test',
      });

      expect(profile.needsApiRefresh()).toBe(false);
    });

    it('should return true for external mode with no lastFetched', () => {
      const profile = new PersonalityProfile({
        mode: 'external',
        name: 'test',
      });
      profile.lastFetched = null;

      expect(profile.needsApiRefresh()).toBe(true);
    });

    it('should return true for stale external profile', () => {
      const profile = new PersonalityProfile({
        mode: 'external',
        name: 'test',
      });
      // Set lastFetched to 2 hours ago
      profile.lastFetched = new Date(Date.now() - 7200000);

      expect(profile.needsApiRefresh()).toBe(true);
    });

    it('should return false for fresh external profile', () => {
      const profile = new PersonalityProfile({
        mode: 'external',
        name: 'test',
      });
      // Set lastFetched to 30 minutes ago
      profile.lastFetched = new Date(Date.now() - 1800000);

      expect(profile.needsApiRefresh()).toBe(false);
    });

    it('should respect custom stale threshold', () => {
      const profile = new PersonalityProfile({
        mode: 'external',
        name: 'test',
      });
      // Set lastFetched to 5 minutes ago
      profile.lastFetched = new Date(Date.now() - 300000);

      // Should be stale with 1 minute threshold
      expect(profile.needsApiRefresh(60000)).toBe(true);

      // Should be fresh with 10 minute threshold
      expect(profile.needsApiRefresh(600000)).toBe(false);
    });
  });

  describe('isLocallyManaged', () => {
    it('should return true for local mode', () => {
      const profile = new PersonalityProfile({
        mode: 'local',
        user_prompt: 'Test',
      });

      expect(profile.isLocallyManaged()).toBe(true);
    });

    it('should return false for external mode', () => {
      const profile = new PersonalityProfile({
        mode: 'external',
        name: 'test',
      });

      expect(profile.isLocallyManaged()).toBe(false);
    });
  });
});
