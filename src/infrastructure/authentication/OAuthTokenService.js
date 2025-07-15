/**
 * OAuth Token Service Implementation
 * 
 * Implements the TokenService interface using OAuth 2.0 flow.
 * This service handles the external OAuth integration for authentication.
 * 
 * @module infrastructure/authentication/OAuthTokenService
 */

const logger = require('../../logger');
const { TokenService } = require('../../domain/authentication/TokenService');

/**
 * OAuth implementation of TokenService
 * 
 * Handles OAuth 2.0 authorization flow including:
 * - Authorization URL generation
 * - Code exchange for tokens
 * - Token validation and refresh
 * - Token revocation
 */
class OAuthTokenService extends TokenService {
  /**
   * @param {Object} config
   * @param {string} config.appId - Application ID
   * @param {string} config.apiKey - API key for authentication
   * @param {string} config.authApiEndpoint - Auth API endpoint URL
   * @param {string} config.authWebsite - Auth website URL
   * @param {string} config.serviceApiBaseUrl - Service API base URL
   * @param {Function} config.httpClient - HTTP client for making requests
   */
  constructor(config = {}) {
    super();
    
    this.appId = config.appId || process.env.SERVICE_APP_ID;
    this.apiKey = config.apiKey || process.env.SERVICE_API_KEY;
    this.authApiEndpoint = config.authApiEndpoint || `${process.env.SERVICE_API_BASE_URL}/auth`;
    this.authWebsite = config.authWebsite || process.env.SERVICE_WEBSITE;
    this.serviceApiBaseUrl = config.serviceApiBaseUrl || process.env.SERVICE_API_BASE_URL;
    
    // Injectable HTTP client for testing
    this.httpClient = config.httpClient || require('node-fetch');
    
    if (!this.appId) {
      throw new Error('App ID is required for OAuth token service');
    }
    if (!this.apiKey) {
      throw new Error('API key is required for OAuth token service');
    }
  }

  /**
   * Get OAuth authorization URL
   * @param {string} state - OAuth state parameter
   * @returns {Promise<string>} Authorization URL
   */
  async getAuthorizationUrl(state) {
    try {
      logger.info('[OAuthTokenService] Generating authorization URL');
      
      const params = new URLSearchParams({
        app_id: this.appId,
        state: state || '',
      });
      
      const authUrl = `${this.authWebsite}/auth/discord?${params.toString()}`;
      
      logger.info('[OAuthTokenService] Generated auth URL:', authUrl);
      return authUrl;
    } catch (error) {
      logger.error('[OAuthTokenService] Failed to generate auth URL:', error);
      throw error;
    }
  }

  /**
   * Exchange authorization code for token
   * @param {string} code - OAuth authorization code
   * @param {string} userId - User ID requesting the token
   * @returns {Promise<{token: string, expiresAt: Date}>}
   */
  async exchangeCode(code, userId) {
    try {
      logger.info(`[OAuthTokenService] Exchanging code for user ${userId}`);
      
      const response = await this.httpClient(
        `${this.authApiEndpoint}/exchange`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
          body: JSON.stringify({
            code,
            discord_id: userId,
          }),
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data || !data.token) {
        throw new Error(`OAuth exchange failed: ${data?.error || response.statusText}`);
      }
      
      // Let the AI service handle token expiry
      // We only store expiresAt if the API provides it
      let expiresAt = null;
      if (data.expires_at) {
        expiresAt = new Date(data.expires_at);
      }
      
      logger.info(`[OAuthTokenService] Successfully exchanged code for user ${userId}`);
      
      return {
        token: data.token,
        expiresAt,
      };
    } catch (error) {
      logger.error(`[OAuthTokenService] Failed to exchange code for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Exchange Discord user ID for token (legacy method)
   * @param {string} userId - Discord user ID
   * @returns {Promise<{token: string, expiresAt: Date}>}
   */
  async exchangeToken(userId) {
    try {
      logger.info(`[OAuthTokenService] Direct token exchange for user ${userId}`);
      
      const response = await this.httpClient(
        `${this.authApiEndpoint}/token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
          body: JSON.stringify({
            discord_id: userId,
          }),
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data || !data.token) {
        throw new Error(`Token exchange failed: ${data?.error || response.statusText}`);
      }
      
      // Let the AI service handle token expiry
      // We only store expiresAt if the API provides it
      let expiresAt = null;
      if (data.expires_at) {
        expiresAt = new Date(data.expires_at);
      }
      
      return {
        token: data.token,
        expiresAt,
      };
    } catch (error) {
      logger.error(`[OAuthTokenService] Failed to exchange token for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Validate token
   * @param {string} token - Token to validate
   * @returns {Promise<{valid: boolean, userId?: string}>}
   */
  async validateToken(token) {
    try {
      logger.info('[OAuthTokenService] Validating token:', {
        tokenPrefix: token.substring(0, 8) + '...',
        endpoint: `${this.authApiEndpoint}/validate`
      });
      
      const response = await this.httpClient(
        `${this.authApiEndpoint}/validate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
          body: JSON.stringify({
            token,
          }),
        }
      );
      
      const data = response.ok ? await response.json() : null;
      
      logger.info('[OAuthTokenService] Token validation response:', {
        status: response.status,
        statusText: response.statusText,
        data: data,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      if (!data) {
        logger.warn('[OAuthTokenService] No response data from validation endpoint');
        return { valid: false };
      }
      
      const result = {
        valid: data.valid === true,
        userId: data.discord_id,
      };
      
      logger.info('[OAuthTokenService] Validation result:', result);
      return result;
    } catch (error) {
      logger.error('[OAuthTokenService] Failed to validate token:', {
        message: error.message,
        code: error.code
      });
      
      // Network errors should be thrown, not treated as invalid tokens
      throw error;
    }
  }

  /**
   * Refresh token
   * @param {string} token - Token to refresh
   * @returns {Promise<{token: string, expiresAt: Date}>}
   */
  async refreshToken(token) {
    try {
      logger.info('[OAuthTokenService] Refreshing token');
      
      const response = await this.httpClient(
        `${this.authApiEndpoint}/refresh`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
          body: JSON.stringify({
            token,
          }),
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data || !data.token) {
        throw new Error(`Token refresh failed: ${data?.error || response.statusText}`);
      }
      
      // Let the AI service handle token expiry
      // We only store expiresAt if the API provides it
      let expiresAt = null;
      if (data.expires_at) {
        expiresAt = new Date(data.expires_at);
      }
      
      logger.info('[OAuthTokenService] Successfully refreshed token');
      
      return {
        token: data.token,
        expiresAt,
      };
    } catch (error) {
      logger.error('[OAuthTokenService] Failed to refresh token:', error);
      throw error;
    }
  }

  /**
   * Revoke token
   * @param {string} token - Token to revoke
   * @returns {Promise<void>}
   */
  async revokeToken(token) {
    try {
      logger.info('[OAuthTokenService] Revoking token');
      
      const response = await this.httpClient(
        `${this.authApiEndpoint}/revoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
          body: JSON.stringify({
            token,
          }),
        }
      );
      
      if (!response.ok) {
        throw new Error(`Token revoke failed: ${response.statusText}`);
      }
      
      logger.info('[OAuthTokenService] Successfully revoked token');
    } catch (error) {
      logger.error('[OAuthTokenService] Failed to revoke token:', error);
      
      // Token revocation failures are not critical
      // The token will expire naturally
      if (error.message && error.message.includes('404')) {
        logger.warn('[OAuthTokenService] Token not found for revocation, may already be revoked');
        return;
      }
      
      throw error;
    }
  }

  /**
   * Get user info from token
   * @param {string} token - Authentication token
   * @returns {Promise<{userId: string, username: string, discriminator: string}>}
   */
  async getUserInfo(token) {
    try {
      logger.info('[OAuthTokenService] Getting user info');
      
      const response = await this.httpClient(
        `${this.serviceApiBaseUrl}/v1/profile`,
        {
          method: 'GET',
          headers: {
            'X-User-Auth': token,
          },
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || !data || !data.id) {
        throw new Error(`Get user info failed: ${data?.error || response.statusText}`);
      }
      
      return {
        userId: data.id,
        username: data.username,
        discriminator: data.discriminator,
      };
    } catch (error) {
      logger.error('[OAuthTokenService] Failed to get user info:', error);
      throw error;
    }
  }
}

module.exports = { OAuthTokenService };