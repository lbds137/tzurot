/**
 * @jest-environment node
 * @testType domain
 *
 * Personality Aggregate Test
 * - Pure domain test with no external dependencies
 * - Tests personality aggregate with event sourcing
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const { Personality } = require('../../../../src/domain/personality/Personality');
const { PersonalityId } = require('../../../../src/domain/personality/PersonalityId');
const { PersonalityProfile } = require('../../../../src/domain/personality/PersonalityProfile');
const { UserId } = require('../../../../src/domain/personality/UserId');
const {
  PersonalityCreated,
  PersonalityProfileUpdated,
  PersonalityRemoved,
} = require('../../../../src/domain/personality/PersonalityEvents');
const { AIModel } = require('../../../../src/domain/ai/AIModel');
const { Alias } = require('../../../../src/domain/personality/Alias');

describe('Personality', () => {
  let personalityId;
  let ownerId;
  let profile;
  let model;

  beforeEach(() => {
    jest.clearAllMocks();
    personalityId = new PersonalityId('claude-3-opus');
    ownerId = new UserId('123456789');
    profile = new PersonalityProfile({
      mode: 'local',
      name: 'claude-3-opus',
      displayName: 'Claude 3 Opus',
      prompt: 'You are Claude 3 Opus',
      modelPath: '/default',
      maxWordCount: 1000,
    });
    model = AIModel.createDefault();
  });

  describe('constructor', () => {
    it('should require PersonalityId', () => {
      expect(() => new Personality('string-id')).toThrow(
        'Personality must be created with PersonalityId'
      );
    });

    it('should initialize with PersonalityId', () => {
      const personality = new Personality(personalityId);

      expect(personality.id).toBe('claude-3-opus');
      expect(personality.personalityId).toBe(personalityId);
      expect(personality.ownerId).toBeNull();
      expect(personality.profile).toBeNull();
      expect(personality.removed).toBe(false);
    });
  });

  describe('create', () => {
    it('should create new personality with all required parameters', () => {
      const personality = Personality.create(personalityId, ownerId, profile, model);

      expect(personality).toBeInstanceOf(Personality);
      expect(personality.personalityId).toEqual(personalityId);
      expect(personality.ownerId).toEqual(ownerId);
      // Profile goes through serialization/deserialization which adds default values
      expect(personality.profile.name).toBe(profile.name);
      expect(personality.profile.prompt).toBe(profile.prompt);
      expect(personality.profile.modelPath).toBe(profile.modelPath);
      expect(personality.profile.maxWordCount).toBe(profile.maxWordCount);
      expect(personality.profile.mode).toBe('local');
      expect(personality.model).toEqual(model);
      expect(personality.createdAt).toBeDefined();
      expect(personality.removed).toBe(false);
      expect(personality.version).toBe(1);
    });

    it('should emit PersonalityCreated event', () => {
      const personality = Personality.create(personalityId, ownerId, profile, model);
      const events = personality.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(PersonalityCreated);
      expect(events[0].payload).toMatchObject({
        personalityId: 'claude-3-opus',
        ownerId: '123456789',
        profile: profile.toJSON(),
        model: model.toJSON(),
      });
    });

    it('should validate PersonalityId', () => {
      expect(() => Personality.create('invalid', ownerId, profile, model)).toThrow(
        'Invalid PersonalityId'
      );
    });

    it('should validate UserId', () => {
      expect(() => Personality.create(personalityId, 'invalid', profile, model)).toThrow(
        'Invalid UserId'
      );
    });

    it('should validate PersonalityProfile', () => {
      expect(() => Personality.create(personalityId, ownerId, 'invalid', model)).toThrow(
        'Invalid PersonalityProfile'
      );
    });

    it('should validate AIModel', () => {
      expect(() => Personality.create(personalityId, ownerId, profile, 'invalid')).toThrow(
        'Invalid AIModel'
      );
    });
  });

  describe('updateProfile', () => {
    let personality;

    beforeEach(() => {
      personality = Personality.create(personalityId, ownerId, profile, model);
      personality.markEventsAsCommitted();
    });

    it('should update profile fields', () => {
      const updates = {
        prompt: 'You are an updated Claude',
        modelPath: '/new-model',
        maxWordCount: 2000,
      };

      personality.updateProfile(updates);

      expect(personality.profile.prompt).toBe(updates.prompt);
      expect(personality.profile.modelPath).toBe(updates.modelPath);
      expect(personality.profile.maxWordCount).toBe(updates.maxWordCount);
    });

    it('should emit PersonalityProfileUpdated event', () => {
      const updates = {
        prompt: 'Updated prompt',
      };

      personality.updateProfile(updates);
      const events = personality.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(PersonalityProfileUpdated);
      expect(events[0].payload.profile).toMatchObject({
        prompt: 'Updated prompt',
      });
    });

    it('should update model if provided', () => {
      const newModel = new AIModel('gpt-4', '/gpt-4', {
        supportsImages: true,
        supportsAudio: false,
        maxTokens: 8192,
      });

      personality.updateProfile({ model: newModel });

      expect(personality.model).toEqual(newModel);
    });

    it('should reject removed personality', () => {
      personality.remove();

      expect(() => personality.updateProfile({ prompt: 'new' })).toThrow(
        'Cannot update removed personality'
      );
    });
  });

  describe('remove', () => {
    let personality;

    beforeEach(() => {
      personality = Personality.create(personalityId, ownerId, profile, model);
      personality.markEventsAsCommitted();
    });

    it('should mark personality as removed', () => {
      personality.remove();

      expect(personality.removed).toBe(true);
    });

    it('should emit PersonalityRemoved event', () => {
      personality.remove();
      const events = personality.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(PersonalityRemoved);
      expect(events[0].payload.removedBy).toBe('123456789');
    });

    it('should reject if already removed', () => {
      personality.remove();

      expect(() => personality.remove()).toThrow('Personality already removed');
    });
  });

  describe('aliases', () => {
    let personality;

    beforeEach(() => {
      personality = Personality.create(personalityId, ownerId, profile, model);
      personality.markEventsAsCommitted();
    });

    it('should add alias', () => {
      const alias = new Alias('claude');

      personality.addAlias(alias);

      expect(personality.aliases).toContainEqual(alias);
    });

    it('should reject duplicate alias', () => {
      const alias = new Alias('claude');

      personality.addAlias(alias);

      expect(() => personality.addAlias(alias)).toThrow('Alias "claude" already exists');
    });

    it('should remove alias', () => {
      const alias = new Alias('claude');

      personality.addAlias(alias);
      personality.removeAlias(alias);

      expect(personality.aliases).not.toContainEqual(alias);
    });

    it('should reject removing non-existent alias', () => {
      const alias = new Alias('claude');

      expect(() => personality.removeAlias(alias)).toThrow('Alias "claude" not found');
    });
  });

  describe('isOwnedBy', () => {
    let personality;

    beforeEach(() => {
      personality = Personality.create(personalityId, ownerId, profile, model);
    });

    it('should return true for owner', () => {
      expect(personality.isOwnedBy(ownerId)).toBe(true);
    });

    it('should return false for different user', () => {
      const otherUser = new UserId('987654321');
      expect(personality.isOwnedBy(otherUser)).toBe(false);
    });

    it('should return false for non-UserId', () => {
      expect(personality.isOwnedBy('123456789')).toBe(false);
      expect(personality.isOwnedBy(null)).toBe(false);
    });
  });

  describe('getDisplayName', () => {
    let personality;

    beforeEach(() => {
      personality = Personality.create(personalityId, ownerId, profile, model);
    });

    it('should return display name from profile', () => {
      expect(personality.getDisplayName()).toBe('Claude 3 Opus');
    });

    it('should fall back to personality ID if no display name', () => {
      // Create a profile without displayName
      const profileWithoutDisplayName = new PersonalityProfile({
        mode: 'local',
        name: 'claude-3-opus',
        prompt: 'You are Claude 3 Opus',
        modelPath: '/default',
        maxWordCount: 1000,
      });
      const personalityWithoutDisplayName = Personality.create(
        personalityId,
        ownerId,
        profileWithoutDisplayName,
        model
      );
      
      expect(personalityWithoutDisplayName.getDisplayName()).toBe('claude-3-opus');
    });
  });

  describe('needsProfileRefresh', () => {
    let personality;

    beforeEach(() => {
      personality = Personality.create(personalityId, ownerId, profile, model);
    });

    it('should return false for fresh profile', () => {
      // Profile was just created, should be fresh
      expect(personality.needsProfileRefresh()).toBe(false);
    });

    it('should return true if profile is stale', () => {
      // Mock time passing - 2 hours later
      const originalNow = Date.now;
      const twoHoursLater = Date.now() + 2 * 60 * 60 * 1000;
      Date.now = jest.fn(() => twoHoursLater);

      // Check with 1 hour threshold - should be stale
      expect(personality.needsProfileRefresh(60 * 60 * 1000)).toBe(true);

      // Restore Date.now
      Date.now = originalNow;
    });

    it('should use custom threshold', () => {
      // Mock time passing - even 1ms later
      const originalNow = Date.now;
      const oneMsLater = Date.now() + 1;
      Date.now = jest.fn(() => oneMsLater);

      // With 0ms threshold, always stale
      expect(personality.needsProfileRefresh(0)).toBe(true);

      // Restore Date.now
      Date.now = originalNow;
    });
  });

  describe('event sourcing', () => {
    it('should rebuild state from events', () => {
      const events = [
        new PersonalityCreated('claude-3-opus', {
          personalityId: 'claude-3-opus',
          ownerId: '123456789',
          profile: profile.toJSON(),
          model: model.toJSON(),
          createdAt: new Date().toISOString(),
        }),
        new PersonalityProfileUpdated('claude-3-opus', {
          profile: {
            name: 'claude-3-opus',
            prompt: 'Updated prompt',
            modelPath: '/default',
            maxWordCount: 1000,
          },
          updatedAt: new Date().toISOString(),
        }),
      ];

      const personality = new Personality(personalityId);
      personality.loadFromHistory(events);

      expect(personality.personalityId.value).toBe('claude-3-opus');
      expect(personality.ownerId.value).toBe('123456789');
      expect(personality.profile.prompt).toBe('Updated prompt');
      expect(personality.removed).toBe(false);
      expect(personality.version).toBe(2);
    });
  });

  describe('toJSON', () => {
    it('should serialize personality to JSON', () => {
      const personality = Personality.create(personalityId, ownerId, profile, model);

      const json = personality.toJSON();

      expect(json.id).toBe('claude-3-opus');
      expect(json.personalityId).toBe('claude-3-opus');
      expect(json.ownerId).toBe('123456789');
      expect(json.aliases).toEqual([]);
      expect(json.removed).toBe(false);
      expect(json.version).toBe(1);
      expect(json.createdAt).toBeDefined();
      expect(json.updatedAt).toBeDefined();

      // Check profile separately as it gets normalized
      expect(json.profile.name).toBe('claude-3-opus');
      expect(json.profile.prompt).toBe('You are Claude 3 Opus');
      expect(json.profile.modelPath).toBe('/default');
      expect(json.profile.maxWordCount).toBe(1000);
      expect(json.profile.mode).toBe('local');

      // Check model
      expect(json.model).toEqual(model.toJSON());
    });
  });
});
