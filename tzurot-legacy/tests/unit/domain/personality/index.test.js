/**
 * @jest-environment node
 * @testType index
 *
 * Personality Domain Index Test
 * - Tests exports of the personality domain module
 * - Verifies API surface and basic functionality
 * - Pure tests with no external dependencies
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Module under test - NOT mocked!
const personalityDomain = require('../../../../src/domain/personality/index');
const { AIModel } = require('../../../../src/domain/ai/AIModel');

describe('Personality Domain Index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('exports', () => {
    it('should export all aggregates', () => {
      expect(personalityDomain.Personality).toBeDefined();
      expect(typeof personalityDomain.Personality).toBe('function');
    });

    it('should export all value objects', () => {
      expect(personalityDomain.PersonalityId).toBeDefined();
      expect(typeof personalityDomain.PersonalityId).toBe('function');

      expect(personalityDomain.PersonalityProfile).toBeDefined();
      expect(typeof personalityDomain.PersonalityProfile).toBe('function');

      expect(personalityDomain.UserId).toBeDefined();
      expect(typeof personalityDomain.UserId).toBe('function');

      expect(personalityDomain.Alias).toBeDefined();
      expect(typeof personalityDomain.Alias).toBe('function');
    });

    it('should export all repositories', () => {
      expect(personalityDomain.PersonalityRepository).toBeDefined();
      expect(typeof personalityDomain.PersonalityRepository).toBe('function');
    });

    it('should export all events', () => {
      expect(personalityDomain.PersonalityCreated).toBeDefined();
      expect(typeof personalityDomain.PersonalityCreated).toBe('function');

      expect(personalityDomain.PersonalityProfileUpdated).toBeDefined();
      expect(typeof personalityDomain.PersonalityProfileUpdated).toBe('function');

      expect(personalityDomain.PersonalityRemoved).toBeDefined();
      expect(typeof personalityDomain.PersonalityRemoved).toBe('function');

      expect(personalityDomain.PersonalityAliasAdded).toBeDefined();
      expect(typeof personalityDomain.PersonalityAliasAdded).toBe('function');

      expect(personalityDomain.PersonalityAliasRemoved).toBeDefined();
      expect(typeof personalityDomain.PersonalityAliasRemoved).toBe('function');
    });
  });

  describe('functionality', () => {
    it('should allow creating personalities', () => {
      const personalityId = new personalityDomain.PersonalityId('test-personality');
      const userId = new personalityDomain.UserId('123456789012345678');
      const profile = new personalityDomain.PersonalityProfile({
        mode: 'local',
        name: 'test-personality',
        displayName: 'Test Personality',
        prompt: 'You are a test personality',
        modelPath: '/default',
        maxWordCount: 1000,
      });
      const model = AIModel.createDefault();

      const personality = personalityDomain.Personality.create(
        personalityId,
        userId,
        profile,
        model
      );

      expect(personality).toBeInstanceOf(personalityDomain.Personality);
    });

    it('should allow creating personality IDs', () => {
      const id1 = new personalityDomain.PersonalityId('test-personality');
      const id2 = personalityDomain.PersonalityId.fromString('another-personality');

      expect(id1).toBeInstanceOf(personalityDomain.PersonalityId);
      expect(id2).toBeInstanceOf(personalityDomain.PersonalityId);
    });

    it('should allow creating user IDs', () => {
      const userId = new personalityDomain.UserId('123456789012345678');

      expect(userId).toBeInstanceOf(personalityDomain.UserId);
    });

    it('should allow creating aliases', () => {
      const alias = new personalityDomain.Alias('test-alias');

      expect(alias).toBeInstanceOf(personalityDomain.Alias);
    });

    it('should allow creating personality events', () => {
      const personalityId = new personalityDomain.PersonalityId('test-personality');
      const userId = new personalityDomain.UserId('123456789012345678');
      const profile = new personalityDomain.PersonalityProfile({
        displayName: 'Test Personality',
        avatarUrl: null,
        errorMessage: null,
      });

      const event = new personalityDomain.PersonalityCreated(personalityId.toString(), {
        personalityId: personalityId.toJSON(),
        ownerId: userId.toJSON(),
        createdAt: new Date().toISOString(),
      });

      expect(event).toBeInstanceOf(personalityDomain.PersonalityCreated);
    });
  });

  describe('domain boundary', () => {
    it('should not export internal implementation details', () => {
      // These should not be exported
      expect(personalityDomain.PersonalityStatus).toBeUndefined();
      expect(personalityDomain.PersonalityValidator).toBeUndefined();
      expect(personalityDomain.PersonalityData).toBeUndefined();
    });

    it('should provide complete public API', () => {
      const exportedKeys = Object.keys(personalityDomain);
      const expectedKeys = [
        'Personality',
        'PersonalityId',
        'PersonalityProfile',
        'PersonalityConfiguration',
        'UserId',
        'Alias',
        'PersonalityRepository',
        'PersonalityCreated',
        'PersonalityProfileUpdated',
        'PersonalityRemoved',
        'PersonalityAliasAdded',
        'PersonalityAliasRemoved',
      ];

      for (const key of expectedKeys) {
        expect(exportedKeys).toContain(key);
      }

      expect(exportedKeys).toHaveLength(expectedKeys.length);
    });
  });
});
