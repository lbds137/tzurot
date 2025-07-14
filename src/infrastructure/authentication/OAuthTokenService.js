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
    this.httpClient = config.httpClient || require('axios');
    
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
      
      const response = await this.httpClient.post(
        `${this.authApiEndpoint}/exchange`,
        {
          code,
          discord_id: userId,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
        }
      );
      
      if (!response.data || !response.data.token) {
        throw new Error('Invalid response from auth service');
      }
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // Default 30 days
      
      if (response.data.expires_at) {
        expiresAt.setTime(new Date(response.data.expires_at).getTime());
      }
      
      logger.info(`[OAuthTokenService] Successfully exchanged code for user ${userId}`);
      
      return {
        token: response.data.token,
        expiresAt,
      };
    } catch (error) {
      logger.error(`[OAuthTokenService] Failed to exchange code for user ${userId}:`, error);
      
      if (error.response) {
        const errorMessage = error.response.data?.error || 'Unknown error';
        throw new Error(`OAuth exchange failed: ${errorMessage}`);
      }
      
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
      
      const response = await this.httpClient.post(
        `${this.authApiEndpoint}/token`,
        {
          discord_id: userId,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
        }
      );
      
      if (!response.data || !response.data.token) {
        throw new Error('Invalid response from auth service');
      }
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // Default 30 days
      
      if (response.data.expires_at) {
        expiresAt.setTime(new Date(response.data.expires_at).getTime());
      }
      
      return {
        token: response.data.token,
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
      logger.info('[OAuthTokenService] Validating token');
      
      const response = await this.httpClient.post(
        `${this.authApiEndpoint}/validate`,
        {
          token,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
        }
      );
      
      if (!response.data) {
        return { valid: false };
      }
      
      return {
        valid: response.data.valid === true,
        userId: response.data.discord_id,
      };
    } catch (error) {
      logger.error('[OAuthTokenService] Failed to validate token:', error);
      
      // Treat validation errors as invalid token
      if (error.response && error.response.status === 401) {
        return { valid: false };
      }
      
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
      
      const response = await this.httpClient.post(
        `${this.authApiEndpoint}/refresh`,
        {
          token,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
        }
      );
      
      if (!response.data || !response.data.token) {
        throw new Error('Invalid response from auth service');
      }
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // Default 30 days
      
      if (response.data.expires_at) {
        expiresAt.setTime(new Date(response.data.expires_at).getTime());
      }
      
      logger.info('[OAuthTokenService] Successfully refreshed token');
      
      return {
        token: response.data.token,
        expiresAt,
      };
    } catch (error) {
      logger.error('[OAuthTokenService] Failed to refresh token:', error);
      
      if (error.response && error.response.status === 401) {
        throw new Error('Token is invalid or expired');
      }
      
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
      
      await this.httpClient.post(
        `${this.authApiEndpoint}/revoke`,
        {
          token,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
        }
      );
      
      logger.info('[OAuthTokenService] Successfully revoked token');
    } catch (error) {
      logger.error('[OAuthTokenService] Failed to revoke token:', error);
      
      // Token revocation failures are not critical
      // The token will expire naturally
      if (error.response && error.response.status === 404) {
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
      
      const response = await this.httpClient.get(
        `${this.serviceApiBaseUrl}/v1/profile`,
        {
          headers: {
            'X-User-Auth': token,
          },
        }
      );
      
      if (!response.data || !response.data.id) {
        throw new Error('Invalid user info response');
      }
      
      return {
        userId: response.data.id,
        username: response.data.username,
        discriminator: response.data.discriminator,
      };
    } catch (error) {
      logger.error('[OAuthTokenService] Failed to get user info:', error);
      throw error;
    }
  }
}

module.exports = { OAuthTokenService };