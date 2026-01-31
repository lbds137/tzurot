/**
 * BlacklistedUser - Value object representing a blacklisted user
 * @module domain/blacklist/BlacklistedUser
 */

const { UserId } = require('../personality/UserId');

/**
 * @class BlacklistedUser
 * @description Value object for blacklisted user information
 */
class BlacklistedUser {
  /**
   * @param {string} userId - User ID
   * @param {string} reason - Reason for blacklisting
   * @param {string} blacklistedBy - ID of user who blacklisted
   * @param {Date} blacklistedAt - When blacklisted
   */
  constructor(userId, reason, blacklistedBy, blacklistedAt) {
    if (!userId) {
      throw new Error('User ID is required');
    }

    if (!reason || typeof reason !== 'string') {
      throw new Error('Blacklist reason is required');
    }

    if (!blacklistedBy) {
      throw new Error('Blacklisted by user ID is required');
    }

    if (!(blacklistedAt instanceof Date)) {
      throw new Error('Blacklisted at must be a Date');
    }

    this.userId = new UserId(userId);
    this.reason = reason;
    this.blacklistedBy = new UserId(blacklistedBy);
    this.blacklistedAt = blacklistedAt;
  }

  /**
   * Create from plain data
   * @static
   * @param {Object} data - Plain data object
   * @returns {BlacklistedUser}
   */
  static fromData(data) {
    return new BlacklistedUser(
      data.userId,
      data.reason,
      data.blacklistedBy,
      new Date(data.blacklistedAt)
    );
  }

  /**
   * Convert to JSON for persistence
   * @returns {Object}
   */
  toJSON() {
    return {
      userId: this.userId.toString(),
      reason: this.reason,
      blacklistedBy: this.blacklistedBy.toString(),
      blacklistedAt: this.blacklistedAt.toISOString(),
    };
  }

  /**
   * Check equality
   * @param {BlacklistedUser} other
   * @returns {boolean}
   */
  equals(other) {
    if (!(other instanceof BlacklistedUser)) {
      return false;
    }

    return (
      this.userId.equals(other.userId) &&
      this.reason === other.reason &&
      this.blacklistedBy.equals(other.blacklistedBy) &&
      this.blacklistedAt.getTime() === other.blacklistedAt.getTime()
    );
  }
}

module.exports = { BlacklistedUser };
