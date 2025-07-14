/**
 * Authentication Anti-Corruption Layer (ACL)
 * 
 * This layer acts as a facade/adapter between the legacy AuthManager and the new
 * DDD authentication system. It implements the same interface as AuthManager but
 * delegates to either the legacy system or the new DDD system based on configuration.
 * 
 * During migration, it can run both systems in parallel (shadow mode) to verify
 * the new implementation matches the legacy behavior.
 * 
 * @module application/services/AuthenticationAntiCorruptionLayer
 */

const logger = require('../../logger');
const { AuthContext } = require('../../domain/authentication/AuthContext');

/**
 * Anti-Corruption Layer for Authentication
 * 
 * Provides a unified interface that can delegate to either:
 * - Legacy AuthManager (current production system)
 * - New DDD AuthenticationApplicationService
 * - Both in shadow mode for verification
 */
class AuthenticationAntiCorruptionLayer {
  /**
   * @param {Object} dependencies
   * @param {AuthManager} dependencies.legacyAuthManager - Legacy auth manager
   * @param {AuthenticationApplicationService} dependencies.authApplicationService - New DDD auth service
   * @param {boolean} dependencies.shadowMode - Run both systems and compare results
   * @param {boolean} dependencies.useDDD - Use DDD implementation as primary
   */
  constructor({
    legacyAuthManager,
    authApplicationService,
    shadowMode = false,
    useDDD = false,
  }) {
    if (!legacyAuthManager && !authApplicationService) {
      throw new Error('At least one auth implementation is required');
    }

    this.legacyAuthManager = legacyAuthManager;
    this.authApplicationService = authApplicationService;
    this.shadowMode = shadowMode;
    this.useDDD = useDDD;
    
    // Track shadow mode discrepancies
    this.discrepancies = [];
  }

  /**
   * Initialize the auth system
   */
  async initialize() {
    logger.info('[AuthACL] Initializing authentication systems');
    
    try {
      // Always initialize legacy if available (needed for gradual migration)
      if (this.legacyAuthManager) {
        await this.legacyAuthManager.initialize();
        logger.info('[AuthACL] Legacy auth manager initialized');
      }
      
      // Initialize DDD if we're using it
      if (this.authApplicationService && (this.useDDD || this.shadowMode)) {
        // DDD auth service doesn't need initialization
        logger.info('[AuthACL] DDD auth service ready');
      }
    } catch (error) {
      logger.error('[AuthACL] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Get authorization URL
   * @param {string} discordUserId - Discord user ID
   * @returns {Promise<string>} Authorization URL
   */
  async getAuthorizationUrl(discordUserId) {
    if (this.shadowMode) {
      return this._runInShadowMode('getAuthorizationUrl', async () => {
        // Legacy
        const legacyUrl = await this.legacyAuthManager.getAuthorizationUrl(discordUserId);
        
        // DDD
        const dddUrl = await this.authApplicationService.getAuthorizationUrl(discordUserId);
        
        return { legacy: legacyUrl, ddd: dddUrl };
      });
    }
    
    if (this.useDDD) {
      return await this.authApplicationService.getAuthorizationUrl(discordUserId);
    }
    
    return await this.legacyAuthManager.getAuthorizationUrl(discordUserId);
  }

  /**
   * Exchange OAuth code for token
   * @param {string} userId - Discord user ID
   * @param {string} code - OAuth code
   * @returns {Promise<Object>} Token response
   */
  async exchangeCodeForToken(userId, code) {
    if (this.shadowMode) {
      return this._runInShadowMode('exchangeCodeForToken', async () => {
        // Legacy
        const legacyResult = await this.legacyAuthManager.handleOAuthCallback(userId, code);
        
        // DDD
        const dddResult = await this.authApplicationService.exchangeCodeForToken(userId, code);
        
        return { 
          legacy: legacyResult, 
          ddd: {
            success: !!dddResult.token,
            message: dddResult.token ? 'Authentication successful!' : 'Authentication failed',
          }
        };
      });
    }
    
    if (this.useDDD) {
      const result = await this.authApplicationService.exchangeCodeForToken(userId, code);
      return {
        success: !!result.token,
        message: result.token ? 'Authentication successful!' : 'Authentication failed',
      };
    }
    
    return await this.legacyAuthManager.handleOAuthCallback(userId, code);
  }

  /**
   * Check if user is authenticated
   * @param {string} userId - Discord user ID
   * @returns {Promise<boolean>}
   */
  async isUserAuthenticated(userId) {
    if (this.shadowMode) {
      return this._runInShadowMode('isUserAuthenticated', async () => {
        // Legacy
        const legacyAuth = this.legacyAuthManager.isUserAuthenticated(userId);
        
        // DDD
        const dddStatus = await this.authApplicationService.getAuthenticationStatus(userId);
        
        return { legacy: legacyAuth, ddd: dddStatus.isAuthenticated };
      });
    }
    
    if (this.useDDD) {
      const status = await this.authApplicationService.getAuthenticationStatus(userId);
      return status.isAuthenticated;
    }
    
    return this.legacyAuthManager.isUserAuthenticated(userId);
  }

  /**
   * Get user token
   * @param {string} userId - Discord user ID
   * @returns {string|null} User token
   */
  getUserToken(userId) {
    // DDD doesn't expose tokens directly for security
    // This method only works with legacy
    if (this.legacyAuthManager) {
      return this.legacyAuthManager.getUserToken(userId);
    }
    
    logger.warn('[AuthACL] getUserToken not available in DDD mode');
    return null;
  }

  /**
   * Validate user access to personality
   * @param {string} userId - Discord user ID
   * @param {Object} personality - Personality object
   * @param {Object} context - Context (channel info, etc)
   * @returns {Promise<Object>} Validation result
   */
  async validateUserAccess(userId, personality, context) {
    if (this.shadowMode) {
      return this._runInShadowMode('validateUserAccess', async () => {
        // Legacy
        const legacyResult = await this.legacyAuthManager.personalityAuthValidator.validateAccess(
          userId,
          personality,
          context
        );
        
        // DDD - need to create AuthContext
        const authContext = new AuthContext({
          channelType: context.channelType === 'DM' ? 'DM' : 'GUILD',
          channelId: context.channelId,
          isNsfwChannel: context.isNsfw || false,
          isProxyMessage: context.isProxyMessage || false,
        });
        
        const dddResult = await this.authApplicationService.checkPersonalityAccess(
          userId,
          personality,
          authContext
        );
        
        return { 
          legacy: legacyResult,
          ddd: {
            allowed: dddResult.allowed,
            requiresAuth: !dddResult.allowed && dddResult.reason?.includes('authentication'),
            requiresNsfwVerification: !dddResult.allowed && dddResult.reason?.includes('NSFW'),
            error: dddResult.reason,
          }
        };
      });
    }
    
    if (this.useDDD) {
      const authContext = new AuthContext({
        channelType: context.channelType === 'DM' ? 'DM' : 'GUILD',
        channelId: context.channelId,
        isNsfwChannel: context.isNsfw || false,
        isProxyMessage: context.isProxyMessage || false,
      });
      
      const result = await this.authApplicationService.checkPersonalityAccess(
        userId,
        personality,
        authContext
      );
      
      return {
        allowed: result.allowed,
        requiresAuth: !result.allowed && result.reason?.includes('authentication'),
        requiresNsfwVerification: !result.allowed && result.reason?.includes('NSFW'),
        error: result.reason,
      };
    }
    
    return await this.legacyAuthManager.personalityAuthValidator.validateAccess(
      userId,
      personality,
      context
    );
  }

  /**
   * Verify NSFW access
   * @param {string} userId - Discord user ID
   * @returns {Promise<void>}
   */
  async verifyNsfwAccess(userId) {
    if (this.shadowMode) {
      return this._runInShadowMode('verifyNsfwAccess', async () => {
        // Legacy
        this.legacyAuthManager.nsfwVerificationManager.verifyUser(userId);
        
        // DDD
        await this.authApplicationService.verifyNsfwAccess(userId);
        
        return { legacy: true, ddd: true };
      });
    }
    
    if (this.useDDD) {
      return await this.authApplicationService.verifyNsfwAccess(userId);
    }
    
    return this.legacyAuthManager.nsfwVerificationManager.verifyUser(userId);
  }

  /**
   * Check if user is NSFW verified
   * @param {string} userId - Discord user ID
   * @returns {boolean}
   */
  async isUserNsfwVerified(userId) {
    if (this.shadowMode) {
      return this._runInShadowMode('isUserNsfwVerified', async () => {
        // Legacy
        const legacyVerified = this.legacyAuthManager.nsfwVerificationManager.isUserVerified(userId);
        
        // DDD
        const status = await this.authApplicationService.getAuthenticationStatus(userId);
        const dddVerified = status.user?.nsfwStatus?.isVerified || false;
        
        return { legacy: legacyVerified, ddd: dddVerified };
      });
    }
    
    if (this.useDDD) {
      const status = await this.authApplicationService.getAuthenticationStatus(userId);
      return status.user?.nsfwStatus?.isVerified || false;
    }
    
    return this.legacyAuthManager.nsfwVerificationManager.isUserVerified(userId);
  }

  /**
   * Revoke user authentication
   * @param {string} userId - Discord user ID
   * @returns {Promise<Object>} Revocation result
   */
  async revokeAuthentication(userId) {
    if (this.shadowMode) {
      return this._runInShadowMode('revokeAuthentication', async () => {
        // Legacy
        const legacyResult = await this.legacyAuthManager.revokeUserAuth(userId);
        
        // DDD
        await this.authApplicationService.revokeAuthentication(userId);
        const dddResult = { success: true, message: 'Authentication revoked' };
        
        return { legacy: legacyResult, ddd: dddResult };
      });
    }
    
    if (this.useDDD) {
      await this.authApplicationService.revokeAuthentication(userId);
      return { success: true, message: 'Authentication revoked' };
    }
    
    return await this.legacyAuthManager.revokeUserAuth(userId);
  }

  /**
   * Clean up expired tokens
   * @returns {Promise<number>} Number of tokens cleaned
   */
  async cleanupExpiredTokens() {
    if (this.shadowMode) {
      return this._runInShadowMode('cleanupExpiredTokens', async () => {
        // Legacy
        const legacyCount = await this.legacyAuthManager.cleanupExpiredTokens();
        
        // DDD
        const dddCount = await this.authApplicationService.cleanupExpiredTokens();
        
        return { legacy: legacyCount, ddd: dddCount };
      });
    }
    
    if (this.useDDD) {
      return await this.authApplicationService.cleanupExpiredTokens();
    }
    
    return await this.legacyAuthManager.cleanupExpiredTokens();
  }

  /**
   * Create AI client for user
   * @param {string} userId - Discord user ID
   * @returns {Promise<Object>} AI client
   */
  async createUserAIClient(userId) {
    // For now, only legacy supports AI client creation
    // DDD will need AIClientFactory integration
    if (this.legacyAuthManager) {
      return this.legacyAuthManager.aiClientFactory.createUserClient(userId);
    }
    
    throw new Error('AI client creation not yet implemented in DDD mode');
  }

  /**
   * Get auth statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStatistics() {
    if (this.shadowMode) {
      return this._runInShadowMode('getStatistics', async () => {
        // Legacy doesn't have a direct stats method
        const legacyStats = {
          authenticatedUsers: this.legacyAuthManager.userTokenManager.getAllTokens().size,
          verifiedUsers: this.legacyAuthManager.nsfwVerificationManager.verifications.size,
        };
        
        // DDD
        const dddStats = await this.authApplicationService.getStatistics();
        
        return { legacy: legacyStats, ddd: dddStats };
      });
    }
    
    if (this.useDDD) {
      return await this.authApplicationService.getStatistics();
    }
    
    // Legacy stats
    return {
      authenticatedUsers: this.legacyAuthManager.userTokenManager.getAllTokens().size,
      verifiedUsers: this.legacyAuthManager.nsfwVerificationManager.verifications.size,
    };
  }

  /**
   * Run operation in shadow mode
   * @private
   */
  async _runInShadowMode(operation, executor) {
    try {
      const results = await executor();
      
      // Compare results
      const discrepancy = this._compareResults(operation, results.legacy, results.ddd);
      
      if (discrepancy) {
        this.discrepancies.push({
          operation,
          timestamp: new Date(),
          legacy: results.legacy,
          ddd: results.ddd,
          discrepancy,
        });
        
        logger.warn(`[AuthACL] Shadow mode discrepancy in ${operation}:`, discrepancy);
      } else {
        logger.info(`[AuthACL] Shadow mode match for ${operation}`);
      }
      
      // Always return legacy result in shadow mode
      return results.legacy;
    } catch (error) {
      logger.error(`[AuthACL] Shadow mode error in ${operation}:`, error);
      
      // If one system fails, try to return the other's result
      if (error.system === 'ddd' && this.legacyAuthManager) {
        logger.warn('[AuthACL] DDD failed, returning legacy result');
        return error.legacyResult;
      }
      
      throw error;
    }
  }

  /**
   * Compare results between legacy and DDD
   * @private
   */
  _compareResults(operation, legacyResult, dddResult) {
    // Simple comparison for now
    // Can be enhanced with operation-specific comparisons
    
    if (typeof legacyResult !== typeof dddResult) {
      return `Type mismatch: legacy=${typeof legacyResult}, ddd=${typeof dddResult}`;
    }
    
    if (typeof legacyResult === 'boolean' && legacyResult !== dddResult) {
      return `Boolean mismatch: legacy=${legacyResult}, ddd=${dddResult}`;
    }
    
    if (typeof legacyResult === 'object' && legacyResult !== null && dddResult !== null) {
      // For objects, do a shallow comparison of key properties
      const keys = new Set([...Object.keys(legacyResult), ...Object.keys(dddResult)]);
      
      for (const key of keys) {
        if (legacyResult[key] !== dddResult[key]) {
          return `Property mismatch for '${key}': legacy=${legacyResult[key]}, ddd=${dddResult[key]}`;
        }
      }
    }
    
    return null; // No discrepancy
  }

  /**
   * Get shadow mode discrepancies
   */
  getDiscrepancies() {
    return this.discrepancies;
  }

  /**
   * Clear shadow mode discrepancies
   */
  clearDiscrepancies() {
    this.discrepancies = [];
  }
}

module.exports = { AuthenticationAntiCorruptionLayer };