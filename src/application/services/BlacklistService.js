/**
 * BlacklistService - Application service for global blacklist management
 * @module application/services/BlacklistService
 */

const {
  BlacklistedUser,
  UserBlacklistedGlobally,
  UserUnblacklistedGlobally,
} = require('../../domain/blacklist');
const logger = require('../../logger');

/**
 * @class BlacklistService
 * @description Application service for managing the global user blacklist
 */
class BlacklistService {
  /**
   * @param {Object} dependencies
   * @param {BlacklistRepository} dependencies.blacklistRepository - Repository for blacklist persistence
   * @param {EventBus} dependencies.eventBus - Event bus for domain events
   */
  constructor({ blacklistRepository, eventBus }) {
    if (!blacklistRepository) {
      throw new Error('BlacklistRepository is required');
    }

    if (!eventBus) {
      throw new Error('EventBus is required');
    }

    this.blacklistRepository = blacklistRepository;
    this.eventBus = eventBus;
  }

  /**
   * Blacklist a user globally
   * @param {string} userId - User ID to blacklist
   * @param {string} reason - Reason for blacklisting
   * @param {string} blacklistedBy - ID of user performing the blacklist
   * @returns {Promise<void>}
   */
  async blacklistUser(userId, reason, blacklistedBy) {
    logger.info(
      `[BlacklistService] Blacklisting user ${userId} by ${blacklistedBy}. Reason: ${reason}`
    );

    try {
      // Check if already blacklisted
      const existing = await this.blacklistRepository.find(userId);
      if (existing) {
        throw new Error('User is already blacklisted');
      }

      // Create blacklisted user
      const blacklistedUser = new BlacklistedUser(userId, reason, blacklistedBy, new Date());

      // Save to repository
      await this.blacklistRepository.add(blacklistedUser);

      // Emit domain event
      const event = new UserBlacklistedGlobally(userId, {
        userId,
        reason,
        blacklistedBy,
        blacklistedAt: blacklistedUser.blacklistedAt.toISOString(),
      });

      await this.eventBus.publish(event);

      logger.info(`[BlacklistService] Successfully blacklisted user ${userId}`);
    } catch (error) {
      logger.error(`[BlacklistService] Failed to blacklist user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Remove a user from the global blacklist
   * @param {string} userId - User ID to unblacklist
   * @param {string} unblacklistedBy - ID of user performing the unblacklist
   * @returns {Promise<void>}
   */
  async unblacklistUser(userId, unblacklistedBy) {
    logger.info(`[BlacklistService] Unblacklisting user ${userId} by ${unblacklistedBy}`);

    try {
      // Check if blacklisted
      const blacklistedUser = await this.blacklistRepository.find(userId);
      if (!blacklistedUser) {
        throw new Error('User is not blacklisted');
      }

      // Remove from repository
      await this.blacklistRepository.remove(userId);

      // Emit domain event
      const event = new UserUnblacklistedGlobally(userId, {
        userId,
        unblacklistedBy,
        unblacklistedAt: new Date().toISOString(),
        previousReason: blacklistedUser.reason,
      });

      await this.eventBus.publish(event);

      logger.info(`[BlacklistService] Successfully unblacklisted user ${userId}`);
    } catch (error) {
      logger.error(`[BlacklistService] Failed to unblacklist user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Check if a user is blacklisted
   * @param {string} userId - User ID to check
   * @returns {Promise<boolean>}
   */
  async isUserBlacklisted(userId) {
    try {
      return await this.blacklistRepository.isBlacklisted(userId);
    } catch (error) {
      logger.error(`[BlacklistService] Failed to check blacklist status for ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get all blacklisted users
   * @returns {Promise<BlacklistedUser[]>}
   */
  async getBlacklistedUsers() {
    try {
      return await this.blacklistRepository.findAll();
    } catch (error) {
      logger.error('[BlacklistService] Failed to get blacklisted users:', error);
      throw error;
    }
  }

  /**
   * Get blacklist details for a specific user
   * @param {string} userId - User ID to check
   * @returns {Promise<BlacklistedUser|null>}
   */
  async getBlacklistDetails(userId) {
    try {
      return await this.blacklistRepository.find(userId);
    } catch (error) {
      logger.error(`[BlacklistService] Failed to get blacklist details for ${userId}:`, error);
      throw error;
    }
  }
}

module.exports = { BlacklistService };
