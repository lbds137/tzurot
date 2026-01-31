/**
 * Webhook Module Index
 *
 * Exports all webhook-related functionality
 */

const threadHandler = require('./threadHandler');
const messageThrottler = require('./messageThrottler');
const dmHandler = require('./dmHandler');
const messageUtils = require('./messageUtils');

module.exports = {
  // Thread handling
  sendDirectThreadMessage: threadHandler.sendDirectThreadMessage,

  // Message throttling
  createPersonalityChannelKey: messageThrottler.createPersonalityChannelKey,
  hasPersonalityPendingMessage: messageThrottler.hasPersonalityPendingMessage,
  registerPendingMessage: messageThrottler.registerPendingMessage,
  clearPendingMessage: messageThrottler.clearPendingMessage,
  calculateMessageDelay: messageThrottler.calculateMessageDelay,
  updateChannelLastMessageTime: messageThrottler.updateChannelLastMessageTime,
  clearAllPendingMessages: messageThrottler.clearAllPendingMessages,
  getThrottlerState: messageThrottler.getThrottlerState,

  // DM handling
  sendFormattedMessageInDM: dmHandler.sendFormattedMessageInDM,

  // Message utilities
  getStandardizedUsername: messageUtils.getStandardizedUsername,
  generateMessageTrackingId: messageUtils.generateMessageTrackingId,
  prepareMessageData: messageUtils.prepareMessageData,
  createVirtualResult: messageUtils.createVirtualResult,
  sendMessageChunk: messageUtils.sendMessageChunk,
  minimizeConsoleOutput: messageUtils.minimizeConsoleOutput,
  restoreConsoleOutput: messageUtils.restoreConsoleOutput,

  // Constants
  MAX_ERROR_WAIT_TIME: messageThrottler.MAX_ERROR_WAIT_TIME,
  MIN_MESSAGE_DELAY: messageThrottler.MIN_MESSAGE_DELAY,
};
