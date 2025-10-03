/**
 * Token service interface
 * @module domain/authentication/TokenService
 */

/**
 * @interface TokenService
 * @description External service for token operations
 */
class TokenService {
  /**
   * Exchange Discord user ID for authentication token
   * @param {string} userId - Discord user ID
   * @returns {Promise<{token: string, expiresAt: Date}>} Token data
   */
  async exchangeToken(_userId) {
    throw new Error('TokenService.exchangeToken() must be implemented');
  }

  /**
   * Validate a token
   * @param {string} token - Token to validate
   * @returns {Promise<boolean>} True if valid
   */
  async validateToken(_token) {
    throw new Error('TokenService.validateToken() must be implemented');
  }

  /**
   * Refresh an existing token
   * @param {string} token - Current token
   * @returns {Promise<{token: string, expiresAt: Date}>} New token data
   */
  async refreshToken(_token) {
    throw new Error('TokenService.refreshToken() must be implemented');
  }

  /**
   * Revoke a token
   * @param {string} token - Token to revoke
   * @returns {Promise<void>}
   */
  async revokeToken(_token) {
    throw new Error('TokenService.revokeToken() must be implemented');
  }
}

module.exports = { TokenService };
