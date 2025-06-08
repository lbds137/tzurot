/**
 * Personality aggregate root
 * @module domain/personality/Personality
 */

const { AggregateRoot } = require('../shared/AggregateRoot');
const { PersonalityId } = require('./PersonalityId');
const { PersonalityProfile } = require('./PersonalityProfile');
const { UserId } = require('./UserId');
const { 
  PersonalityCreated,
  PersonalityProfileUpdated,
  PersonalityRemoved 
} = require('./PersonalityEvents');

/**
 * @class Personality
 * @extends AggregateRoot
 * @description Aggregate root for personality bounded context
 */
class Personality extends AggregateRoot {
  constructor(id) {
    if (!(id instanceof PersonalityId)) {
      throw new Error('Personality must be created with PersonalityId');
    }
    
    super(id.toString());
    
    this.personalityId = id;
    this.ownerId = null;
    this.profile = null;
    this.createdAt = null;
    this.updatedAt = null;
    this.removed = false;
  }

  /**
   * Create a new personality
   * @static
   * @param {PersonalityId} personalityId - Unique personality identifier
   * @param {UserId} ownerId - User who owns this personality
   * @returns {Personality} New personality instance
   */
  static create(personalityId, ownerId) {
    if (!(personalityId instanceof PersonalityId)) {
      throw new Error('Invalid PersonalityId');
    }
    
    if (!(ownerId instanceof UserId)) {
      throw new Error('Invalid UserId');
    }
    
    const personality = new Personality(personalityId);
    
    personality.applyEvent(new PersonalityCreated(
      personalityId.toString(),
      {
        personalityId: personalityId.toString(),
        ownerId: ownerId.toString(),
        createdAt: new Date().toISOString(),
      }
    ));
    
    return personality;
  }

  /**
   * Update personality profile
   * @param {PersonalityProfile} profile - New profile data
   */
  updateProfile(profile) {
    if (this.removed) {
      throw new Error('Cannot update removed personality');
    }
    
    if (!(profile instanceof PersonalityProfile)) {
      throw new Error('Invalid PersonalityProfile');
    }
    
    // Only apply event if profile actually changed
    if (!this.profile || !this.profile.equals(profile)) {
      this.applyEvent(new PersonalityProfileUpdated(
        this.id,
        {
          profile: profile.toJSON(),
          updatedAt: new Date().toISOString(),
        }
      ));
    }
  }

  /**
   * Remove personality
   * @param {UserId} removedBy - User removing the personality
   */
  remove(removedBy) {
    if (this.removed) {
      throw new Error('Personality already removed');
    }
    
    if (!(removedBy instanceof UserId)) {
      throw new Error('Invalid UserId');
    }
    
    // Only owner can remove personality
    if (!this.ownerId.equals(removedBy)) {
      throw new Error('Only personality owner can remove it');
    }
    
    this.applyEvent(new PersonalityRemoved(
      this.id,
      {
        removedBy: removedBy.toString(),
        removedAt: new Date().toISOString(),
      }
    ));
  }

  /**
   * Check if user owns this personality
   * @param {UserId} userId - User to check
   * @returns {boolean} True if user owns personality
   */
  isOwnedBy(userId) {
    if (!(userId instanceof UserId)) {
      return false;
    }
    return this.ownerId && this.ownerId.equals(userId);
  }

  /**
   * Get display name (falls back to ID if not set)
   * @returns {string} Display name
   */
  getDisplayName() {
    return this.profile?.displayName || this.personalityId.toString();
  }

  /**
   * Check if profile needs refreshing
   * @param {number} staleThresholdMs - Milliseconds before profile is stale
   * @returns {boolean} True if profile needs refresh
   */
  needsProfileRefresh(staleThresholdMs = 60 * 60 * 1000) {
    // Need refresh if no profile or profile is empty (no displayName)
    if (!this.profile || !this.profile.displayName || !this.updatedAt) {
      return true;
    }
    
    const lastUpdate = new Date(this.updatedAt).getTime();
    const now = Date.now();
    
    return (now - lastUpdate) > staleThresholdMs;
  }

  // Event handlers
  // eslint-disable-next-line no-unused-vars
  onPersonalityCreated(event) {
    this.personalityId = PersonalityId.fromString(event.payload.personalityId);
    this.ownerId = UserId.fromString(event.payload.ownerId);
    this.profile = PersonalityProfile.createEmpty();
    this.createdAt = event.payload.createdAt;
    this.updatedAt = event.payload.createdAt;
    this.removed = false;
  }

  // eslint-disable-next-line no-unused-vars
  onPersonalityProfileUpdated(event) {
    this.profile = PersonalityProfile.fromJSON(event.payload.profile);
    this.updatedAt = event.payload.updatedAt;
  }

  // eslint-disable-next-line no-unused-vars
  onPersonalityRemoved(event) {
    this.removed = true;
    this.updatedAt = event.payload.removedAt;
  }

  // Serialization
  toJSON() {
    return {
      id: this.id,
      personalityId: this.personalityId.toString(),
      ownerId: this.ownerId.toString(),
      profile: this.profile ? this.profile.toJSON() : null,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      removed: this.removed,
      version: this.version,
    };
  }
}

module.exports = { Personality };