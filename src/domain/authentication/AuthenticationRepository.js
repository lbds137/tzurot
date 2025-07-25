/**
 * Authentication repository interface
 * @module domain/authentication/AuthenticationRepository
 */

/**
 * @interface AuthenticationRepository
 * @description Repository interface for authentication persistence
 */
class AuthenticationRepository {
  /**
   * Save user authentication
   * @param {UserAuth} userAuth - User authentication to save
   * @returns {Promise<void>}
   */
  async save(_userAuth) {
    throw new Error('AuthenticationRepository.save() must be implemented');
  }

  /**
   * Find authentication by user ID
   * @param {UserId} userId - User ID
   * @returns {Promise<UserAuth|null>} User auth or null
   */
  async findByUserId(_userId) {
    throw new Error('AuthenticationRepository.findByUserId() must be implemented');
  }

  /**
   * @deprecated Use BlacklistRepository instead
   * Find all blacklisted users
   * @returns {Promise<UserAuth[]>} Blacklisted users
   */
  async findBlacklisted() {
    throw new Error('AuthenticationRepository.findBlacklisted() must be implemented');
  }

  /**
   * Find users with expired tokens
   * @param {Date} expiryDate - Check tokens expired before this
   * @returns {Promise<UserAuth[]>} Users with expired tokens
   */
  async findExpiredTokens(_expiryDate) {
    throw new Error('AuthenticationRepository.findExpiredTokens() must be implemented');
  }

  /**
   * Delete user authentication
   * @param {UserId} userId - User ID
   * @returns {Promise<void>}
   */
  async delete(_userId) {
    throw new Error('AuthenticationRepository.delete() must be implemented');
  }

  /**
   * Count authenticated users
   * @returns {Promise<number>} Count of authenticated users
   */
  async countAuthenticated() {
    throw new Error('AuthenticationRepository.countAuthenticated() must be implemented');
  }
}

module.exports = { AuthenticationRepository };
