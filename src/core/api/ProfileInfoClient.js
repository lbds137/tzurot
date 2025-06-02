/**
 * ProfileInfoClient - Handles API communication for profile information
 *
 * This module is responsible for making HTTP requests to fetch profile
 * information, handling errors, timeouts, and response parsing.
 */

const nodeFetch = require('node-fetch');
const logger = require('../../logger');

class ProfileInfoClient {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000; // 30 seconds default
    this.logPrefix = options.logPrefix || '[ProfileInfoClient]';
    this.fetchImplementation = options.fetchImplementation || nodeFetch;
    this.scheduler = options.scheduler || setTimeout;
    this.clearScheduler = options.clearScheduler || clearTimeout;
  }

  /**
   * Fetch profile information from the API
   * @param {string} endpoint - The API endpoint URL
   * @param {Object} headers - Request headers
   * @returns {Promise<Object|null>} The profile data or null on error
   */
  async fetch(endpoint, headers = {}) {
    const controller = new AbortController();
    const timeoutId = this.scheduler(() => controller.abort(), this.timeout);

    try {
      logger.debug(`${this.logPrefix} Fetching from: ${endpoint}`);

      const response = await this.fetchImplementation(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          Referer: 'https://discord.com/',
          ...headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.error(
          `${this.logPrefix} API response error: ${response.status} ${response.statusText}`
        );
        return {
          success: false,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: null,
        };
      }

      const data = await response.json();
      logger.debug(`${this.logPrefix} Received data: ${JSON.stringify(data).substring(0, 200)}...`);

      return {
        success: true,
        status: response.status,
        data,
      };
    } catch (error) {
      if (error.name === 'AbortError' || error.type === 'aborted') {
        logger.warn(`${this.logPrefix} Request timed out after ${this.timeout}ms`);
        return {
          success: false,
          error: 'timeout',
          message: error.message,
          data: null,
        };
      }

      logger.error(`${this.logPrefix} Network error: ${error.message}`);
      return {
        success: false,
        error: 'network',
        message: error.message,
        data: null,
      };
    } finally {
      this.clearScheduler(timeoutId);
    }
  }

  /**
   * Validate profile data
   * @param {Object} data - The profile data to validate
   * @param {string} profileName - The profile name for logging
   * @returns {boolean} True if data is valid
   */
  validateProfileData(data, profileName) {
    if (!data) {
      logger.error(`${this.logPrefix} Received empty data for: ${profileName}`);
      return false;
    }

    if (!data.name) {
      logger.warn(`${this.logPrefix} Profile data missing 'name' field for: ${profileName}`);
    }

    if (!data.id) {
      logger.warn(`${this.logPrefix} Profile data missing 'id' field for: ${profileName}`);
    }

    return true;
  }
}

module.exports = ProfileInfoClient;
