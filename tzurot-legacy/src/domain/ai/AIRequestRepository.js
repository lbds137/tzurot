/**
 * AI Request repository interface
 * @module domain/ai/AIRequestRepository
 */

/**
 * @interface AIRequestRepository
 * @description Repository interface for AI request persistence
 */
class AIRequestRepository {
  /**
   * Save AI request
   * @param {AIRequest} request - Request to save
   * @returns {Promise<void>}
   */
  async save(request) {
    throw new Error('AIRequestRepository.save() must be implemented');
  }

  /**
   * Find request by ID
   * @param {AIRequestId} requestId - Request ID
   * @returns {Promise<AIRequest|null>} Request or null
   */
  async findById(requestId) {
    throw new Error('AIRequestRepository.findById() must be implemented');
  }

  /**
   * Find requests by user
   * @param {UserId} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<AIRequest[]>} User's requests
   */
  async findByUser(userId, options = {}) {
    throw new Error('AIRequestRepository.findByUser() must be implemented');
  }

  /**
   * Find requests by personality
   * @param {PersonalityId} personalityId - Personality ID
   * @param {Object} options - Query options
   * @returns {Promise<AIRequest[]>} Personality's requests
   */
  async findByPersonality(personalityId, options = {}) {
    throw new Error('AIRequestRepository.findByPersonality() must be implemented');
  }

  /**
   * Find pending requests
   * @returns {Promise<AIRequest[]>} Pending requests
   */
  async findPending() {
    throw new Error('AIRequestRepository.findPending() must be implemented');
  }

  /**
   * Find failed requests that can be retried
   * @returns {Promise<AIRequest[]>} Retryable requests
   */
  async findRetryable() {
    throw new Error('AIRequestRepository.findRetryable() must be implemented');
  }

  /**
   * Get request statistics
   * @param {Date} since - Start date
   * @returns {Promise<Object>} Statistics
   */
  async getStatistics(since) {
    throw new Error('AIRequestRepository.getStatistics() must be implemented');
  }

  /**
   * Clean up old requests
   * @param {Date} before - Delete requests before this date
   * @returns {Promise<number>} Number deleted
   */
  async cleanup(before) {
    throw new Error('AIRequestRepository.cleanup() must be implemented');
  }
}

module.exports = { AIRequestRepository };
