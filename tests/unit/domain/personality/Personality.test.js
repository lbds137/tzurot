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
  PersonalityRemoved
} = require('../../../../src/domain/personality/PersonalityEvents');

describe('Personality', () => {
  let personalityId;
  let ownerId;
  
  beforeEach(() => {
    jest.clearAllMocks();
    personalityId = new PersonalityId('claude-3-opus');
    ownerId = new UserId('123456789');
  });
  
  describe('constructor', () => {
    it('should require PersonalityId', () => {
      expect(() => new Personality('string-id')).toThrow('Personality must be created with PersonalityId');
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
    it('should create new personality with owner', () => {
      const personality = Personality.create(personalityId, ownerId);
      
      expect(personality).toBeInstanceOf(Personality);
      expect(personality.personalityId).toEqual(personalityId);
      expect(personality.ownerId).toEqual(ownerId);
      expect(personality.profile).toBeDefined();
      expect(personality.createdAt).toBeDefined();
      expect(personality.removed).toBe(false);
      expect(personality.version).toBe(1);
    });
    
    it('should emit PersonalityCreated event', () => {
      const personality = Personality.create(personalityId, ownerId);
      const events = personality.getUncommittedEvents();
      
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(PersonalityCreated);
      expect(events[0].payload).toMatchObject({
        personalityId: 'claude-3-opus',
        ownerId: '123456789'
      });
    });
    
    it('should validate PersonalityId', () => {
      expect(() => Personality.create('invalid', ownerId)).toThrow('Invalid PersonalityId');
    });
    
    it('should validate UserId', () => {
      expect(() => Personality.create(personalityId, 'invalid')).toThrow('Invalid UserId');
    });
  });
  
  describe('updateProfile', () => {
    let personality;
    
    beforeEach(() => {
      personality = Personality.create(personalityId, ownerId);
      personality.markEventsAsCommitted();
    });
    
    it('should update profile', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude 3 Opus',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Custom error message'
      });
      
      personality.updateProfile(profile);
      
      expect(personality.profile).toEqual(profile);
    });
    
    it('should emit PersonalityProfileUpdated event', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude 3 Opus'
      });
      
      personality.updateProfile(profile);
      const events = personality.getUncommittedEvents();
      
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(PersonalityProfileUpdated);
      expect(events[0].payload.profile).toEqual(profile.toJSON());
    });
    
    it('should not emit event if profile unchanged', () => {
      const profile = new PersonalityProfile({
        displayName: 'Test'
      });
      
      personality.updateProfile(profile);
      personality.markEventsAsCommitted();
      
      // Update with same profile
      personality.updateProfile(profile);
      
      expect(personality.getUncommittedEvents()).toHaveLength(0);
    });
    
    it('should reject removed personality', () => {
      personality.remove(ownerId);
      
      const profile = new PersonalityProfile({ displayName: 'Test' });
      
      expect(() => personality.updateProfile(profile)).toThrow('Cannot update removed personality');
    });
    
    it('should validate PersonalityProfile', () => {
      expect(() => personality.updateProfile({})).toThrow('Invalid PersonalityProfile');
    });
  });
  
  describe('remove', () => {
    let personality;
    
    beforeEach(() => {
      personality = Personality.create(personalityId, ownerId);
      personality.markEventsAsCommitted();
    });
    
    it('should mark personality as removed', () => {
      personality.remove(ownerId);
      
      expect(personality.removed).toBe(true);
    });
    
    it('should emit PersonalityRemoved event', () => {
      personality.remove(ownerId);
      const events = personality.getUncommittedEvents();
      
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(PersonalityRemoved);
      expect(events[0].payload.removedBy).toBe('123456789');
    });
    
    it('should only allow owner to remove', () => {
      const otherUser = new UserId('987654321');
      
      expect(() => personality.remove(otherUser)).toThrow('Only personality owner can remove it');
    });
    
    it('should reject if already removed', () => {
      personality.remove(ownerId);
      
      expect(() => personality.remove(ownerId)).toThrow('Personality already removed');
    });
    
    it('should validate UserId', () => {
      expect(() => personality.remove('invalid')).toThrow('Invalid UserId');
    });
  });
  
  describe('isOwnedBy', () => {
    let personality;
    
    beforeEach(() => {
      personality = Personality.create(personalityId, ownerId);
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
      personality = Personality.create(personalityId, ownerId);
    });
    
    it('should return display name from profile', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude 3 Opus'
      });
      personality.updateProfile(profile);
      
      expect(personality.getDisplayName()).toBe('Claude 3 Opus');
    });
    
    it('should fall back to personality ID if no display name', () => {
      expect(personality.getDisplayName()).toBe('claude-3-opus');
    });
  });
  
  describe('needsProfileRefresh', () => {
    let personality;
    
    beforeEach(() => {
      personality = Personality.create(personalityId, ownerId);
    });
    
    it('should return true if no profile', () => {
      // New personality has empty profile
      expect(personality.needsProfileRefresh()).toBe(true);
    });
    
    it('should return true if profile is stale', () => {
      const profile = new PersonalityProfile({ displayName: 'Test' });
      personality.updateProfile(profile);
      personality.markEventsAsCommitted();
      
      // Mock time passing - 2 hours later
      const originalNow = Date.now;
      const twoHoursLater = Date.now() + 2 * 60 * 60 * 1000;
      Date.now = jest.fn(() => twoHoursLater);
      
      // Check with 1 hour threshold - should be stale
      expect(personality.needsProfileRefresh(60 * 60 * 1000)).toBe(true);
      
      // Restore Date.now
      Date.now = originalNow;
    });
    
    it('should return false if profile is fresh', () => {
      const profile = new PersonalityProfile({ displayName: 'Test' });
      personality.updateProfile(profile);
      personality.markEventsAsCommitted();
      
      // Immediately after update
      expect(personality.needsProfileRefresh()).toBe(false);
    });
    
    it('should use custom threshold', () => {
      const profile = new PersonalityProfile({ displayName: 'Test' });
      personality.updateProfile(profile);
      personality.markEventsAsCommitted();
      
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
          createdAt: new Date().toISOString()
        }),
        new PersonalityProfileUpdated('claude-3-opus', {
          profile: {
            displayName: 'Claude 3 Opus',
            avatarUrl: 'https://example.com/avatar.png',
            errorMessage: 'Error'
          },
          updatedAt: new Date().toISOString()
        })
      ];
      
      const personality = new Personality(personalityId);
      personality.loadFromHistory(events);
      
      expect(personality.personalityId.value).toBe('claude-3-opus');
      expect(personality.ownerId.value).toBe('123456789');
      expect(personality.profile.displayName).toBe('Claude 3 Opus');
      expect(personality.removed).toBe(false);
      expect(personality.version).toBe(2);
    });
  });
  
  describe('toJSON', () => {
    it('should serialize personality to JSON', () => {
      const personality = Personality.create(personalityId, ownerId);
      const profile = new PersonalityProfile({
        displayName: 'Claude 3 Opus'
      });
      personality.updateProfile(profile);
      
      const json = personality.toJSON();
      
      expect(json).toMatchObject({
        id: 'claude-3-opus',
        personalityId: 'claude-3-opus',
        ownerId: '123456789',
        profile: {
          displayName: 'Claude 3 Opus',
          avatarUrl: null,
          errorMessage: null
        },
        removed: false,
        version: 2
      });
      expect(json.createdAt).toBeDefined();
      expect(json.updatedAt).toBeDefined();
    });
  });
});