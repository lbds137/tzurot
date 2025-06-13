/**
 * NSFW status value object
 * @module domain/authentication/NsfwStatus
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class NsfwStatus
 * @extends ValueObject
 * @description Represents NSFW verification status
 */
class NsfwStatus extends ValueObject {
  constructor(verified = false, verifiedAt = null) {
    super();

    this.verified = !!verified;
    this.verifiedAt = verifiedAt;

    this.validate();
  }

  validate() {
    if (this.verified && !this.verifiedAt) {
      throw new Error('Verified status requires verification date');
    }

    if (this.verifiedAt && !(this.verifiedAt instanceof Date)) {
      throw new Error('VerifiedAt must be a Date');
    }

    if (!this.verified && this.verifiedAt) {
      throw new Error('Cannot have verification date without being verified');
    }
  }

  /**
   * Mark as verified
   * @param {Date} [verifiedAt] - Verification time
   * @returns {NsfwStatus} New verified status
   */
  markVerified(verifiedAt = new Date()) {
    return new NsfwStatus(true, verifiedAt);
  }

  /**
   * Clear verification
   * @returns {NsfwStatus} New unverified status
   */
  clearVerification() {
    return new NsfwStatus(false, null);
  }

  /**
   * Check if verification is stale
   * @param {number} maxAgeMs - Maximum age in milliseconds
   * @param {Date} [currentTime] - Current time (for testing)
   * @returns {boolean} True if stale
   */
  isStale(maxAgeMs = 30 * 24 * 60 * 60 * 1000, currentTime = new Date()) {
    if (!this.verified || !this.verifiedAt) {
      return true;
    }

    const age = currentTime.getTime() - this.verifiedAt.getTime();
    return age > maxAgeMs;
  }

  toJSON() {
    return {
      verified: this.verified,
      verifiedAt: this.verifiedAt ? this.verifiedAt.toISOString() : null,
    };
  }

  static fromJSON(data) {
    return new NsfwStatus(data.verified, data.verifiedAt ? new Date(data.verifiedAt) : null);
  }

  static createUnverified() {
    return new NsfwStatus(false, null);
  }

  static createVerified(verifiedAt = new Date()) {
    return new NsfwStatus(true, verifiedAt);
  }
}

module.exports = { NsfwStatus };
