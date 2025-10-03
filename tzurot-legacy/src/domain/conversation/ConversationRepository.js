/**
 * Conversation repository interface
 * @module domain/conversation/ConversationRepository
 */

/**
 * @interface ConversationRepository
 * @description Repository interface for conversation persistence
 */
class ConversationRepository {
  /**
   * Save a conversation aggregate
   * @param {Conversation} conversation - Conversation to save
   * @returns {Promise<void>}
   */
  async save(_conversation) {
    throw new Error('ConversationRepository.save() must be implemented');
  }

  /**
   * Find conversation by ID
   * @param {ConversationId} conversationId - Conversation ID
   * @returns {Promise<Conversation|null>} Conversation or null if not found
   */
  async findById(_conversationId) {
    throw new Error('ConversationRepository.findById() must be implemented');
  }

  /**
   * Find active conversations for a user
   * @param {string} userId - User ID
   * @returns {Promise<Conversation[]>} Array of conversations
   */
  async findActiveByUser(_userId) {
    throw new Error('ConversationRepository.findActiveByUser() must be implemented');
  }

  /**
   * Find conversation by message ID
   * @param {string} messageId - Discord message ID
   * @returns {Promise<Conversation|null>} Conversation containing the message
   */
  async findByMessageId(_messageId) {
    throw new Error('ConversationRepository.findByMessageId() must be implemented');
  }

  /**
   * Find all conversations with a specific personality
   * @param {PersonalityId} personalityId - Personality ID
   * @returns {Promise<Conversation[]>} Array of conversations
   */
  async findByPersonality(_personalityId) {
    throw new Error('ConversationRepository.findByPersonality() must be implemented');
  }

  /**
   * Delete a conversation
   * @param {ConversationId} conversationId - Conversation ID
   * @returns {Promise<void>}
   */
  async delete(_conversationId) {
    throw new Error('ConversationRepository.delete() must be implemented');
  }

  /**
   * Clean up expired conversations
   * @param {Date} expiryDate - Delete conversations ended before this date
   * @returns {Promise<number>} Number of conversations deleted
   */
  async cleanupExpired(_expiryDate) {
    throw new Error('ConversationRepository.cleanupExpired() must be implemented');
  }
}

module.exports = { ConversationRepository };
