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
    it('should create empty profile', () => {
      const profile = new PersonalityProfile({});
      
      expect(profile.displayName).toBeNull();
      expect(profile.avatarUrl).toBeNull();
      expect(profile.errorMessage).toBeNull();
    });
    
    it('should create profile with all fields', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude 3 Opus',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Custom error message'
      });
      
      expect(profile.displayName).toBe('Claude 3 Opus');
      expect(profile.avatarUrl).toBe('https://example.com/avatar.png');
      expect(profile.errorMessage).toBe('Custom error message');
    });
    
    it('should create profile with partial fields', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude'
      });
      
      expect(profile.displayName).toBe('Claude');
      expect(profile.avatarUrl).toBeNull();
      expect(profile.errorMessage).toBeNull();
    });
    
    it('should validate display name type', () => {
      expect(() => new PersonalityProfile({
        displayName: 123
      })).toThrow('Display name must be a string');
    });
    
    it('should validate avatar URL type', () => {
      expect(() => new PersonalityProfile({
        avatarUrl: true
      })).toThrow('Avatar URL must be a string');
    });
    
    it('should validate error message type', () => {
      expect(() => new PersonalityProfile({
        errorMessage: {}
      })).toThrow('Error message must be a string');
    });
  });
  
  describe('withDisplayName', () => {
    it('should create new profile with updated display name', () => {
      const original = new PersonalityProfile({
        displayName: 'Original',
        avatarUrl: 'https://example.com/avatar.png'
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
        errorMessage: 'Error'
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
        avatarUrl: 'https://old.com/avatar.png'
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
        errorMessage: 'Old error'
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
        errorMessage: 'Error message'
      });
      
      expect(profile.isComplete()).toBe(true);
    });
    
    it('should return false when missing display name', () => {
      const profile = new PersonalityProfile({
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error message'
      });
      
      expect(profile.isComplete()).toBe(false);
    });
    
    it('should return false when missing avatar URL', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude',
        errorMessage: 'Error message'
      });
      
      expect(profile.isComplete()).toBe(false);
    });
    
    it('should return false when missing error message', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude',
        avatarUrl: 'https://example.com/avatar.png'
      });
      
      expect(profile.isComplete()).toBe(false);
    });
    
    it('should return false for empty profile', () => {
      const profile = PersonalityProfile.createEmpty();
      
      expect(profile.isComplete()).toBe(false);
    });
  });
  
  describe('toJSON', () => {
    it('should serialize all fields', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error message'
      });
      
      expect(profile.toJSON()).toEqual({
        displayName: 'Claude',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error message'
      });
    });
    
    it('should serialize null fields', () => {
      const profile = new PersonalityProfile({
        displayName: 'Claude'
      });
      
      expect(profile.toJSON()).toEqual({
        displayName: 'Claude',
        avatarUrl: null,
        errorMessage: null
      });
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
        errorMessage: 'Error message'
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
        displayName: 'Claude'
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
        errorMessage: 'Error'
      });
      
      const profile2 = new PersonalityProfile({
        displayName: 'Claude',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error'
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
});