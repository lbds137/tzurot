/**
 * BlacklistEvents - Domain events for blacklist operations
 * @module domain/blacklist/BlacklistEvents
 */

const { DomainEvent } = require('../shared/DomainEvent');

/**
 * Event emitted when a user is blacklisted globally
 */
class UserBlacklistedGlobally extends DomainEvent {
  /**
   * @param {string} userId - User ID that was blacklisted
   * @param {Object} payload - Event payload
   * @param {string} payload.userId - User ID
   * @param {string} payload.reason - Reason for blacklisting
   * @param {string} payload.blacklistedBy - ID of user who blacklisted
   * @param {string} payload.blacklistedAt - ISO timestamp
   */
  constructor(userId, payload) {
    super(userId, payload);
  }
}

/**
 * Event emitted when a user is removed from global blacklist
 */
class UserUnblacklistedGlobally extends DomainEvent {
  /**
   * @param {string} userId - User ID that was unblacklisted
   * @param {Object} payload - Event payload
   * @param {string} payload.userId - User ID
   * @param {string} payload.unblacklistedBy - ID of user who unblacklisted
   * @param {string} payload.unblacklistedAt - ISO timestamp
   * @param {string} payload.previousReason - Previous blacklist reason
   */
  constructor(userId, payload) {
    super(userId, payload);
  }
}

module.exports = {
  UserBlacklistedGlobally,
  UserUnblacklistedGlobally,
};
