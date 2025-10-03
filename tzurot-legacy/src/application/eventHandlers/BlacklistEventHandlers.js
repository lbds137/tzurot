/**
 * BlacklistEventHandlers - Handles domain events from the blacklist system
 * @module application/eventHandlers/BlacklistEventHandlers
 */

const { UserBlacklistedGlobally, UserUnblacklistedGlobally } = require('../../domain/blacklist');
const logger = require('../../logger');

/**
 * Handle user blacklisted globally event
 * When a user is blacklisted, we should:
 * 1. Revoke any existing authentication tokens
 * 2. Clear conversation state
 * 3. Log the action for audit purposes
 *
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} Event handler function
 */
function createUserBlacklistedGloballyHandler(dependencies) {
  const { authenticationRepository, conversationManager } = dependencies;

  return async function handleUserBlacklistedGlobally(event) {
    logger.info(
      `[BlacklistEventHandlers] Processing UserBlacklistedGlobally for user ${event.aggregateId}`
    );

    try {
      // Clean up authentication data
      // We don't delete the entire auth record as it might contain useful history
      // Instead, we expire the token to force re-authentication if unblacklisted
      const userAuth = await authenticationRepository.findByUserId(event.aggregateId);
      if (userAuth && userAuth.isAuthenticated()) {
        userAuth.expireToken();
        await authenticationRepository.save(userAuth);
        logger.info(
          `[BlacklistEventHandlers] Expired authentication token for blacklisted user ${event.aggregateId}`
        );
      }

      // Clear any active conversations
      if (conversationManager && conversationManager.clearUserConversations) {
        conversationManager.clearUserConversations(event.aggregateId);
        logger.info(
          `[BlacklistEventHandlers] Cleared active conversations for blacklisted user ${event.aggregateId}`
        );
      }

      // Log for audit
      logger.info(
        `[BlacklistEventHandlers] User ${event.aggregateId} globally blacklisted by ${event.payload.blacklistedBy}. Reason: ${event.payload.reason}`
      );
    } catch (error) {
      logger.error(`[BlacklistEventHandlers] Error handling UserBlacklistedGlobally:`, error);
      // Don't throw - we don't want event handler failures to affect the blacklist operation
    }
  };
}

/**
 * Handle user unblacklisted globally event
 * When a user is unblacklisted, we just log it for audit purposes.
 * The user will need to re-authenticate if they want to use NSFW features.
 *
 * @returns {Function} Event handler function
 */
function createUserUnblacklistedGloballyHandler() {
  return async function handleUserUnblacklistedGlobally(event) {
    logger.info(
      `[BlacklistEventHandlers] Processing UserUnblacklistedGlobally for user ${event.aggregateId}`
    );

    try {
      // Log for audit
      logger.info(
        `[BlacklistEventHandlers] User ${event.aggregateId} globally unblacklisted by ${event.payload.unblacklistedBy}. Previous reason: ${event.payload.previousReason}`
      );
    } catch (error) {
      logger.error(`[BlacklistEventHandlers] Error handling UserUnblacklistedGlobally:`, error);
      // Don't throw - we don't want event handler failures to affect the unblacklist operation
    }
  };
}

/**
 * Register blacklist event handlers
 * @param {Object} dependencies - Injected dependencies
 * @param {EventBus} dependencies.eventBus - Event bus to register handlers with
 * @param {AuthenticationRepository} dependencies.authenticationRepository - Auth repository
 * @param {Object} dependencies.conversationManager - Conversation manager
 */
function registerBlacklistEventHandlers(dependencies) {
  const { eventBus } = dependencies;

  // Register handlers
  eventBus.subscribe(
    UserBlacklistedGlobally.name,
    createUserBlacklistedGloballyHandler(dependencies)
  );

  eventBus.subscribe(
    UserUnblacklistedGlobally.name,
    createUserUnblacklistedGloballyHandler()
  );

  logger.info('[BlacklistEventHandlers] Registered blacklist event handlers');
}

module.exports = {
  registerBlacklistEventHandlers,
  createUserBlacklistedGloballyHandler,
  createUserUnblacklistedGloballyHandler,
};
