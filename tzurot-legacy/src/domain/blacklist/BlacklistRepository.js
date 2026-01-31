/**
 * BlacklistRepository - Repository interface for blacklist persistence
 * @module domain/blacklist/BlacklistRepository
 */

/**
 * @abstract
 * @class BlacklistRepository
 * @description Repository interface for blacklist operations
 */
class BlacklistRepository {
  /**
   * Add user to blacklist
   * @abstract
   * @param {BlacklistedUser} blacklistedUser - User to blacklist
   * @returns {Promise<void>}
   */
  async add(_blacklistedUser) {
    throw new Error('BlacklistRepository.add must be implemented');
  }

  /**
   * Remove user from blacklist
   * @abstract
   * @param {string} userId - User ID to remove
   * @returns {Promise<void>}
   */
  async remove(_userId) {
    throw new Error('BlacklistRepository.remove must be implemented');
  }

  /**
   * Find blacklisted user by ID
   * @abstract
   * @param {string} userId - User ID to find
   * @returns {Promise<BlacklistedUser|null>}
   */
  async find(_userId) {
    throw new Error('BlacklistRepository.find must be implemented');
  }

  /**
   * Find all blacklisted users
   * @abstract
   * @returns {Promise<BlacklistedUser[]>}
   */
  async findAll() {
    throw new Error('BlacklistRepository.findAll must be implemented');
  }

  /**
   * Check if user is blacklisted
   * @abstract
   * @param {string} userId - User ID to check
   * @returns {Promise<boolean>}
   */
  async isBlacklisted(_userId) {
    throw new Error('BlacklistRepository.isBlacklisted must be implemented');
  }
}

module.exports = { BlacklistRepository };
