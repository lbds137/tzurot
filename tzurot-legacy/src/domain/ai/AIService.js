/**
 * AI Service interface
 * @module domain/ai/AIService
 */

/**
 * @interface AIService
 * @description External AI service interface (anti-corruption layer)
 */
class AIService {
  /**
   * Send request to AI service
   * @param {Object} request - Request data
   * @returns {Promise<Object>} Raw response
   */
  async sendRequest(request) {
    throw new Error('AIService.sendRequest() must be implemented');
  }

  /**
   * Check service health
   * @returns {Promise<boolean>} True if healthy
   */
  async checkHealth() {
    throw new Error('AIService.checkHealth() must be implemented');
  }

  /**
   * Get service metrics
   * @returns {Promise<Object>} Service metrics
   */
  async getMetrics() {
    throw new Error('AIService.getMetrics() must be implemented');
  }
}

module.exports = { AIService };
