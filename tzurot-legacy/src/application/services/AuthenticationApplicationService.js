/**
 * Authentication Application Service
 *
 * Orchestrates authentication operations using domain models and services.
 * This is the main entry point for all authentication-related operations
 * in the DDD architecture.
 *
 * @module application/services/AuthenticationApplicationService
 */

const logger = require('../../logger');
const { botPrefix } = require('../../../config');
const { UserAuth } = require('../../domain/authentication/UserAuth');
const { Token } = require('../../domain/authentication/Token');
const { UserId } = require('../../domain/personality/UserId');
const { DomainEventBus } = require('../../domain/shared/DomainEventBus');
const {
  UserAuthenticated,
  UserTokenRefreshed,
  UserTokenExpired,
  AuthenticationDenied,
  UserNsfwVerified,
  UserNsfwVerificationCleared,
} = require('../../domain/authentication/AuthenticationEvents');

/**
 * Authentication Application Service
 *
 * Responsibilities:
 * - User authentication workflows
 * - Token management (creation, refresh, revocation)
 * - NSFW verification
 * - Permission checking
 * - Coordination between domain services
 */
class AuthenticationApplicationService {
  /**
   * @param {Object} dependencies
   * @param {AuthenticationRepository} dependencies.authenticationRepository
   * @param {TokenService} dependencies.tokenService
   * @param {DomainEventBus} dependencies.eventBus
   * @param {Object} dependencies.config - Application configuration
   */
  constructor({
    authenticationRepository,
    tokenService,
    eventBus = new DomainEventBus(),
    config = {},
  }) {
    if (!authenticationRepository) {
      throw new Error('authenticationRepository is required');
    }
    if (!tokenService) {
      throw new Error('tokenService is required');
    }

    this.authenticationRepository = authenticationRepository;
    this.tokenService = tokenService;
    this.eventBus = eventBus;
    this.config = {
      ownerId: config.ownerId || process.env.BOT_OWNER_ID,
      ...config,
    };
  }

  /**
   * Get authorization URL for OAuth flow
   * @param {string} state - OAuth state parameter
   * @returns {Promise<string>} Authorization URL
   */
  async getAuthorizationUrl(state) {
    try {
      logger.info('[AuthenticationApplicationService] Generating authorization URL');

      // Delegate to token service which handles OAuth specifics
      const url = await this.tokenService.getAuthorizationUrl(state);

      return url;
    } catch (error) {
      logger.error('[AuthenticationApplicationService] Failed to generate auth URL:', error);
      throw error;
    }
  }

  /**
   * Exchange OAuth code for authentication token
   * @param {string} discordUserId - Discord user ID
   * @param {string} code - OAuth authorization code
   * @returns {Promise<{token: string, user: UserAuth}>}
   */
  async exchangeCodeForToken(discordUserId, code) {
    try {
      logger.info(`[AuthenticationApplicationService] Exchanging code for user ${discordUserId}`);

      // Create UserId value object
      const userId = new UserId(discordUserId);

      // Exchange code for token using token service
      const tokenData = await this.tokenService.exchangeCode(code, discordUserId);

      if (!tokenData || !tokenData.token) {
        throw new Error('Failed to exchange code for token');
      }

      // Check if user already exists
      let userAuth = await this.authenticationRepository.findByUserId(userId);

      if (userAuth) {
        // Refresh existing user's token
        const newToken = new Token(
          tokenData.token,
          tokenData.expiresAt ? new Date(tokenData.expiresAt) : null
        );
        userAuth.refreshToken(newToken);

        await this.authenticationRepository.save(userAuth);

        // Publish token refreshed event
        await this.eventBus.publish(
          new UserTokenRefreshed(userId.value, {
            userId: userId.value,
            newToken: newToken.toJSON(),
            refreshedAt: new Date().toISOString(),
          })
        );
      } else {
        // Create new authenticated user
        userAuth = UserAuth.createAuthenticated(
          userId,
          new Token(tokenData.token, tokenData.expiresAt ? new Date(tokenData.expiresAt) : null)
        );

        await this.authenticationRepository.save(userAuth);

        // Publish user authenticated event
        await this.eventBus.publish(
          new UserAuthenticated(userId.value, {
            userId: userId.value,
            token: tokenData.token,
            authenticatedAt: new Date(),
          })
        );
      }

      logger.info(
        `[AuthenticationApplicationService] Successfully authenticated user ${discordUserId}`
      );

      return {
        token: tokenData.token,
        user: userAuth,
      };
    } catch (error) {
      logger.error(
        `[AuthenticationApplicationService] Failed to exchange code for user ${discordUserId}:`,
        error
      );

      // Publish authentication denied event
      await this.eventBus.publish(
        new AuthenticationDenied(discordUserId, {
          userId: discordUserId,
          reason: error.message,
          context: 'OAuth code exchange',
          deniedAt: new Date(),
        })
      );

      throw error;
    }
  }

  /**
   * Get user authentication status
   * @param {string} discordUserId - Discord user ID
   * @param {boolean} validateWithAI - Whether to validate token with AI service
   * @returns {Promise<{isAuthenticated: boolean, user: UserAuth|null}>}
   */
  async getAuthenticationStatus(discordUserId, validateWithAI = false) {
    try {
      const userId = new UserId(discordUserId);
      const userAuth = await this.authenticationRepository.findByUserId(userId);

      if (!userAuth) {
        return {
          isAuthenticated: false,
          user: null,
        };
      }

      // Check if user has a token (client-side check)
      if (!userAuth.isAuthenticated()) {
        logger.info(`[AuthenticationApplicationService] User ${discordUserId} has no token`);
        return {
          isAuthenticated: false,
          user: userAuth,
        };
      }

      // Optionally validate with AI service
      if (validateWithAI && userAuth.token) {
        logger.info(
          `[AuthenticationApplicationService] Validating token with AI service for user ${discordUserId}`
        );
        try {
          const validation = await this.tokenService.validateToken(userAuth.token.value);
          logger.info(`[AuthenticationApplicationService] AI service validation result:`, {
            userId: discordUserId,
            valid: validation.valid,
            validationUserId: validation.userId,
          });

          if (!validation.valid) {
            logger.warn(
              `[AuthenticationApplicationService] AI service rejected token for user ${discordUserId}`
            );
            // Token expired according to AI service, publish event
            await this.eventBus.publish(
              new UserTokenExpired(userId.value, {
                userId: userId.value,
                expiredAt: new Date().toISOString(),
                reason: 'AI service validation failed',
              })
            );

            return {
              isAuthenticated: false,
              user: userAuth,
            };
          }
        } catch (error) {
          logger.error(
            `[AuthenticationApplicationService] Failed to validate token with AI service:`,
            error
          );
          // On validation error, we could either fail safe (return false) or continue (return true)
          // For now, let's continue but log the issue
        }
      }

      return {
        isAuthenticated: true,
        user: userAuth,
      };
    } catch (error) {
      logger.error(
        `[AuthenticationApplicationService] Failed to get auth status for ${discordUserId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Refresh user token
   * @param {string} discordUserId - Discord user ID
   * @returns {Promise<{token: string, user: UserAuth}>}
   */
  async refreshUserToken(discordUserId) {
    try {
      logger.info(`[AuthenticationApplicationService] Refreshing token for user ${discordUserId}`);

      const userId = new UserId(discordUserId);
      const userAuth = await this.authenticationRepository.findByUserId(userId);

      if (!userAuth) {
        throw new Error('User not authenticated');
      }

      if (!userAuth.token) {
        throw new Error('No token to refresh');
      }

      // Refresh token using token service
      const refreshedTokenData = await this.tokenService.refreshToken(userAuth.token.value);

      if (!refreshedTokenData || !refreshedTokenData.token) {
        throw new Error('Failed to refresh token');
      }

      // Update user auth with new token
      const newToken = new Token(refreshedTokenData.token, new Date(refreshedTokenData.expiresAt));
      userAuth.refreshToken(newToken);

      await this.authenticationRepository.save(userAuth);

      // Publish token refreshed event
      await this.eventBus.publish(
        new UserTokenRefreshed(userId.value, {
          userId: userId.value,
          newToken: newToken.toJSON(),
          refreshedAt: new Date().toISOString(),
        })
      );

      logger.info(
        `[AuthenticationApplicationService] Successfully refreshed token for user ${discordUserId}`
      );

      return {
        token: refreshedTokenData.token,
        user: userAuth,
      };
    } catch (error) {
      logger.error(
        `[AuthenticationApplicationService] Failed to refresh token for ${discordUserId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Revoke user authentication
   * @param {string} discordUserId - Discord user ID
   * @returns {Promise<void>}
   */
  async revokeAuthentication(discordUserId) {
    try {
      logger.info(
        `[AuthenticationApplicationService] Revoking authentication for user ${discordUserId}`
      );

      const userId = new UserId(discordUserId);
      const userAuth = await this.authenticationRepository.findByUserId(userId);

      if (!userAuth) {
        logger.warn(
          `[AuthenticationApplicationService] User ${discordUserId} not found for revocation`
        );
        return;
      }

      // Revoke token with token service if exists
      if (userAuth.token) {
        try {
          await this.tokenService.revokeToken(userAuth.token.value);
        } catch (error) {
          logger.warn(
            `[AuthenticationApplicationService] Token service revocation failed for ${discordUserId}:`,
            error.message
          );
          // Continue with local token expiration even if remote revocation fails
          // The token will expire naturally or be cleaned up later
        }
      }

      // Expire token in domain model
      userAuth.expireToken();
      await this.authenticationRepository.save(userAuth);

      // Publish token expired event
      await this.eventBus.publish(
        new UserTokenExpired(userId.value, {
          userId: userId.value,
          expiredAt: new Date().toISOString(),
          reason: 'User revoked authentication',
        })
      );

      logger.info(
        `[AuthenticationApplicationService] Successfully revoked authentication for user ${discordUserId}`
      );
    } catch (error) {
      logger.error(
        `[AuthenticationApplicationService] Failed to revoke auth for ${discordUserId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Verify NSFW access for user
   * @param {string} discordUserId - Discord user ID
   * @returns {Promise<void>}
   */
  async verifyNsfwAccess(discordUserId) {
    try {
      logger.info(
        `[AuthenticationApplicationService] Verifying NSFW access for user ${discordUserId}`
      );

      const userId = new UserId(discordUserId);
      const userAuth = await this.authenticationRepository.findByUserId(userId);

      if (!userAuth) {
        throw new Error('User must be authenticated to verify NSFW access');
      }

      // Verify NSFW access
      userAuth.verifyNsfw();
      await this.authenticationRepository.save(userAuth);

      // Publish NSFW verified event
      await this.eventBus.publish(
        new UserNsfwVerified(userId.value, {
          userId: userId.value,
          verifiedAt: (userAuth.nsfwStatus.verifiedAt || new Date()).toISOString(),
        })
      );

      logger.info(
        `[AuthenticationApplicationService] NSFW access verified for user ${discordUserId}`
      );
    } catch (error) {
      logger.error(
        `[AuthenticationApplicationService] Failed to verify NSFW for ${discordUserId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Clear NSFW verification for user
   * @param {string} discordUserId - Discord user ID
   * @returns {Promise<boolean>} True if verification was cleared
   */
  async clearNsfwVerification(discordUserId) {
    try {
      const userId = new UserId(discordUserId);
      const userAuth = await this.authenticationRepository.findByUserId(userId);

      if (!userAuth || !userAuth.nsfwStatus.verified) {
        return false;
      }

      // Clear NSFW verification
      userAuth.clearNsfwVerification();
      await this.authenticationRepository.save(userAuth);

      // Publish NSFW verification cleared event
      await this.eventBus.publish(
        new UserNsfwVerificationCleared(userId.value, {
          userId: userId.value,
          reason: 'User requested clearing',
          clearedAt: new Date().toISOString(),
        })
      );

      logger.info(
        `[AuthenticationApplicationService] NSFW verification cleared for user ${discordUserId}`
      );
      return true;
    } catch (error) {
      logger.error(
        `[AuthenticationApplicationService] Failed to clear NSFW for ${discordUserId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Check if user can access a personality
   * @param {string} discordUserId - Discord user ID
   * @param {Object} personality - Personality to check access for
   * @param {AuthContext} context - Authentication context
   * @returns {Promise<{allowed: boolean, reason?: string}>}
   */
  async checkPersonalityAccess(discordUserId, personality, context) {
    try {
      const userId = new UserId(discordUserId);

      // Bot owner always has access
      if (discordUserId === this.config.ownerId) {
        return { allowed: true };
      }

      // Check if personality requires authentication
      if (personality.config?.requiresAuth) {
        const userAuth = await this.authenticationRepository.findByUserId(userId);

        if (!userAuth || !userAuth.isAuthenticated()) {
          return {
            allowed: false,
            reason: 'Personality requires authentication',
          };
        }
      }

      // Check authentication first (all personalities are treated as NSFW uniformly)
      const userAuth = await this.authenticationRepository.findByUserId(userId);

      // Authentication check should come before NSFW logic
      if (!userAuth) {
        return {
          allowed: false,
          reason: `Authentication required. Use \`${botPrefix} auth start\` to authenticate first.`,
        };
      }

      // Now check NSFW requirements for authenticated users
      if (!userAuth.canAccessNsfw(personality, context)) {
        // Provide more helpful error message based on context
        let reason = 'NSFW verification required';

        if (context.isDM()) {
          reason = `NSFW verification required for DM interactions. Use \`${botPrefix} verify\` in an NSFW channel first, or interact in an NSFW channel instead.`;
        } else if (!context.isNsfwChannel) {
          reason =
            'This personality can only be used in NSFW channels. Please move to an NSFW channel to interact.';
        }

        return {
          allowed: false,
          reason,
        };
      }

      // Auto-verify user if they're interacting in an NSFW channel and not already verified
      logger.debug(`[AuthenticationApplicationService] Auto-verify check for ${discordUserId}:`, {
        isNsfwChannel: context.isNsfwChannel,
        isVerified: userAuth.nsfwStatus.verified,
        nsfwStatus: userAuth.nsfwStatus.toJSON(),
        personality: personality.name,
      });

      if (context.isNsfwChannel && !userAuth.nsfwStatus.verified) {
        try {
          logger.info(
            `[AuthenticationApplicationService] Auto-verifying user ${discordUserId} via NSFW channel interaction`
          );
          userAuth.verifyNsfw();
          await this.authenticationRepository.save(userAuth);

          logger.info(
            `[AuthenticationApplicationService] Auto-verification saved for ${discordUserId}, new status:`,
            userAuth.nsfwStatus.toJSON()
          );

          // Publish NSFW verified event
          await this.eventBus.publish(
            new UserNsfwVerified(userId.value, {
              userId: userId.value,
              verifiedAt: new Date().toISOString(),
              verificationMethod: 'auto_nsfw_channel',
            })
          );
        } catch (error) {
          logger.error(
            `[AuthenticationApplicationService] Failed to auto-verify user ${discordUserId}:`,
            error
          );
          // Don't fail the access check, just log the error
        }
      }


      return { allowed: true };
    } catch (error) {
      logger.error(
        `[AuthenticationApplicationService] Failed to check access for ${discordUserId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Clean up expired tokens
   * @returns {Promise<number>} Number of tokens cleaned up
   */
  async cleanupExpiredTokens() {
    try {
      logger.info('[AuthenticationApplicationService] Starting expired token cleanup');

      const expiryDate = new Date();
      const expiredUsers = await this.authenticationRepository.findExpiredTokens(expiryDate);

      let cleanedCount = 0;

      for (const userAuth of expiredUsers) {
        userAuth.expireToken();
        await this.authenticationRepository.save(userAuth);

        // Publish token expired event
        await this.eventBus.publish(
          new UserTokenExpired(userAuth.userId.value, {
            userId: userAuth.userId.value,
            expiredAt: (userAuth.token?.expiresAt || new Date()).toISOString(),
            reason: 'Token cleanup',
          })
        );

        cleanedCount++;
      }

      logger.info(`[AuthenticationApplicationService] Cleaned up ${cleanedCount} expired tokens`);
      return cleanedCount;
    } catch (error) {
      logger.error('[AuthenticationApplicationService] Failed to cleanup expired tokens:', error);
      throw error;
    }
  }

  /**
   * Get authentication statistics
   * @returns {Promise<Object>} Authentication statistics
   */
  async getStatistics() {
    try {
      const [authenticatedCount, blacklistedUsers, expiredUsers] = await Promise.all([
        this.authenticationRepository.countAuthenticated(),
        this.authenticationRepository.findBlacklisted(),
        this.authenticationRepository.findExpiredTokens(new Date()),
      ]);

      return {
        totalAuthenticated: authenticatedCount,
        blacklistedCount: blacklistedUsers.length,
        expiredTokensCount: expiredUsers.length,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('[AuthenticationApplicationService] Failed to get statistics:', error);
      throw error;
    }
  }

  /**
   * @deprecated Use BlacklistService instead
   * Blacklist methods have been moved to the global blacklist system
   */

  /**
   * Create AI client for authenticated user
   * @param {string} discordUserId - Discord user ID
   * @param {Object} context - Request context
   * @returns {Promise<Object>} AI client instance
   */
  async createAIClient(discordUserId, context = {}) {
    try {
      const userId = new UserId(discordUserId);
      const userAuth = await this.authenticationRepository.findByUserId(userId);

      if (!userAuth || !userAuth.isAuthenticated()) {
        throw new Error('User not authenticated');
      }

      // Create OpenAI client with user authentication
      const { OpenAI } = require('openai');

      const headers = {
        'X-User-Auth': userAuth.token.value,
      };

      if (context.isWebhook) {
        headers['Tzurot-Webhook-Bypass'] = 'true';
      }

      const client = new OpenAI({
        apiKey: process.env.SERVICE_API_KEY,
        baseURL: `${process.env.SERVICE_API_BASE_URL}/v1`,
        defaultHeaders: headers,
      });

      logger.debug(
        `[AuthenticationApplicationService] Created AI client for user ${discordUserId} with user token`
      );
      return client;
    } catch (error) {
      logger.error(
        `[AuthenticationApplicationService] Failed to create AI client for ${discordUserId}:`,
        error
      );
      throw error;
    }
  }
}

module.exports = { AuthenticationApplicationService };
