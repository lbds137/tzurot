/**
 * BackupAPIClient Infrastructure
 * Handles API communication for backup operations
 */

const nodeFetch = require('node-fetch');
const logger = require('../../logger');
const { getPersonalityJargonTerm, getPrivateProfileInfoPath } = require('../../../config');
const { resolvePersonality } = require('../../utils/aliasResolver');
// Note: getApplicationBootstrap imported lazily to avoid circular dependency

/**
 * API client for backup operations
 */
class BackupAPIClient {
  /**
   * Create API client
   * @param {Object} options - Client options
   * @param {string} [options.apiBaseUrl] - Base URL for API
   * @param {number} [options.timeout] - Request timeout in milliseconds
   * @param {Object} [options.scheduler] - Timer scheduler (for testing)
   * @param {Function} [options.fetch] - Fetch implementation (for testing)
   */
  constructor({
    apiBaseUrl = null,
    timeout = 120000, // 2 minutes for backup operations with large datasets
    scheduler = null,
    clearScheduler = null,
    fetch = null,
  } = {}) {
    this.apiBaseUrl = apiBaseUrl || this._getDefaultApiBaseUrl();
    this.timeout = timeout;
    this.scheduler = scheduler || globalThis.setTimeout || setTimeout;
    this.clearScheduler = clearScheduler || globalThis.clearTimeout || clearTimeout;
    this.fetch = fetch || nodeFetch;
  }

  /**
   * Fetch current user information from the "me" endpoint
   * @param {Object} authData - Authentication data
   * @returns {Promise<Object>} User data with id field
   */
  async fetchCurrentUser(authData) {
    const url = `${this.apiBaseUrl}/users/me`;
    logger.info(`[BackupAPIClient] Fetching current user info from: ${url}`);
    return await this._makeAuthenticatedRequest(url, authData);
  }

  /**
   * Fetch personalities by category (self or recent)
   * @param {string} category - Category type ('self' or 'recent')
   * @param {Object} authData - Authentication data
   * @returns {Promise<Array>} Array of personality data
   */
  async fetchPersonalitiesByCategory(category, authData) {
    const personalityJargon = getPersonalityJargonTerm();
    const url = `${this.apiBaseUrl}/${personalityJargon}?category=${category}`;
    logger.info(`[BackupAPIClient] Fetching ${category} personalities from: ${url}`);

    try {
      const personalities = await this._makeAuthenticatedRequest(url, authData);

      if (!Array.isArray(personalities)) {
        logger.error(
          `[BackupAPIClient] Expected array of personalities, got:`,
          typeof personalities
        );
        return [];
      }

      logger.info(`[BackupAPIClient] Retrieved ${personalities.length} ${category} personalities`);
      return personalities;
    } catch (error) {
      logger.error(`[BackupAPIClient] Error fetching ${category} personalities:`, error.message);
      throw error;
    }
  }

  /**
   * Resolve a personality name/alias to the actual full name
   * @param {string} input - User input (could be full name, alias, or display name)
   * @returns {Promise<{fullName: string, displayName: string} | null>} Resolved personality info or null if not found
   */
  async resolvePersonalityName(input) {
    logger.debug(`[BackupAPIClient] Resolving personality name for input: "${input}"`);

    try {
      // Use DDD system to resolve personality by name or alias
      const personality = await resolvePersonality(input);
      if (personality) {
        const fullName = personality.profile?.name || personality.name;
        const displayName = personality.profile?.displayName || fullName;

        logger.debug(`[BackupAPIClient] Found personality: ${fullName}`);
        return {
          fullName: fullName,
          displayName: displayName,
        };
      }

      logger.debug(`[BackupAPIClient] No personality found for input: "${input}"`);
      return null;
    } catch (error) {
      logger.error(`[BackupAPIClient] Error resolving personality name: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch personality profile data
   * @param {string} personalityName - Full name of personality (should be resolved first)
   * @param {Object} authData - Authentication data
   * @returns {Promise<Object>} Profile data
   */
  async fetchPersonalityProfile(personalityName, authData) {
    const privatePath = getPrivateProfileInfoPath();
    const url = `${this.apiBaseUrl}/${privatePath}/${personalityName}`;
    logger.info(`[BackupAPIClient] Fetching profile from: ${url}`);
    return await this._makeAuthenticatedRequest(url, authData);
  }

  /**
   * Fetch all memories for a personality
   * @param {string} personalityId - Personality ID
   * @param {string} personalityName - Personality name
   * @param {Object} authData - Authentication data
   * @returns {Promise<Array>} Array of memory objects
   */
  async fetchAllMemories(personalityId, personalityName, authData) {
    logger.info(`[BackupAPIClient] Fetching all memories for ${personalityName}...`);

    const allMemories = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const url = `${this.apiBaseUrl}/memory/${personalityId}?page=${page}`;
      logger.info(`[BackupAPIClient] Fetching memory page ${page}...`);
      const response = await this._makeAuthenticatedRequest(url, authData);

      const memories = response.items || [];
      if (memories.length > 0) {
        allMemories.unshift(...memories);
      }

      // Check pagination
      const pagination = response.pagination || response.meta?.pagination;
      if (pagination) {
        totalPages = pagination.total_pages || pagination.totalPages || 1;
      }

      if (page >= totalPages) {
        break;
      }

      page++;
    }

    // Sort memories by created_at timestamp (oldest first)
    allMemories.sort((a, b) => {
      const timeA =
        typeof a.created_at === 'number'
          ? a.created_at
          : new Date(a.created_at || a.timestamp || 0).getTime() / 1000;
      const timeB =
        typeof b.created_at === 'number'
          ? b.created_at
          : new Date(b.created_at || b.timestamp || 0).getTime() / 1000;
      return timeA - timeB;
    });

    logger.info(`[BackupAPIClient] Fetched ${allMemories.length} total memories`);
    return allMemories;
  }

  /**
   * Fetch knowledge/story data for a personality
   * @param {string} personalityId - Personality ID
   * @param {string} personalityName - Personality name
   * @param {Object} authData - Authentication data
   * @returns {Promise<Array>} Array of knowledge objects
   */
  async fetchKnowledgeData(personalityId, personalityName, authData) {
    logger.info(`[BackupAPIClient] Fetching knowledge/story data for ${personalityName}...`);

    try {
      const jargonTerm = getPersonalityJargonTerm();
      if (!jargonTerm) {
        throw new Error('PERSONALITY_JARGON_TERM environment variable not configured');
      }
      const url = `${this.apiBaseUrl}/${jargonTerm}/${personalityId}/story`;
      const response = await this._makeAuthenticatedRequest(url, authData);

      let knowledge = [];
      if (Array.isArray(response)) {
        knowledge = response;
      } else if (response.items) {
        knowledge = response.items;
      } else if (response.story || response.knowledge) {
        knowledge = response.story || response.knowledge;
      } else if (response && Object.keys(response).length > 0) {
        knowledge = [response];
      }

      logger.info(`[BackupAPIClient] Fetched ${knowledge.length} knowledge/story entries`);
      return knowledge;
    } catch (error) {
      logger.error(
        `[BackupAPIClient] Error fetching knowledge for ${personalityName}: ${error.message}`
      );
      return [];
    }
  }

  /**
   * Fetch training data for a personality
   * @param {string} personalityId - Personality ID
   * @param {string} personalityName - Personality name
   * @param {Object} authData - Authentication data
   * @returns {Promise<Array>} Array of training objects
   */
  async fetchTrainingData(personalityId, personalityName, authData) {
    logger.info(`[BackupAPIClient] Fetching training data for ${personalityName}...`);

    try {
      const jargonTerm = getPersonalityJargonTerm();
      if (!jargonTerm) {
        throw new Error('PERSONALITY_JARGON_TERM environment variable not configured');
      }
      const url = `${this.apiBaseUrl}/${jargonTerm}/${personalityId}/training`;
      const response = await this._makeAuthenticatedRequest(url, authData);

      let training = [];
      if (Array.isArray(response)) {
        training = response;
      } else if (response.items) {
        training = response.items;
      } else if (response.training) {
        training = response.training;
      } else if (response && Object.keys(response).length > 0) {
        training = [response];
      }

      logger.info(`[BackupAPIClient] Fetched ${training.length} training entries`);
      return training;
    } catch (error) {
      logger.error(
        `[BackupAPIClient] Error fetching training for ${personalityName}: ${error.message}`
      );
      return [];
    }
  }

  /**
   * Fetch user personalization data for a personality
   * @param {string} personalityId - Personality ID
   * @param {string} personalityName - Personality name
   * @param {Object} authData - Authentication data
   * @returns {Promise<Object>} User personalization object
   */
  async fetchUserPersonalizationData(personalityId, personalityName, authData) {
    logger.info(`[BackupAPIClient] Fetching user personalization data for ${personalityName}...`);

    try {
      const jargonTerm = getPersonalityJargonTerm();
      if (!jargonTerm) {
        throw new Error('PERSONALITY_JARGON_TERM environment variable not configured');
      }
      const url = `${this.apiBaseUrl}/${jargonTerm}/${personalityId}/user`;
      const response = await this._makeAuthenticatedRequest(url, authData);

      if (response && Object.keys(response).length > 0) {
        logger.info(`[BackupAPIClient] Fetched user personalization data`);
        return response;
      } else {
        logger.info(`[BackupAPIClient] No user personalization data found for ${personalityName}`);
        return {};
      }
    } catch (error) {
      logger.error(
        `[BackupAPIClient] Error fetching user personalization for ${personalityName}: ${error.message}`
      );
      return {};
    }
  }

  /**
   * Fetch complete chat history using pagination
   * @param {string} personalityId - Personality ID
   * @param {string} personalityName - Personality name
   * @param {Object} authData - Authentication data
   * @returns {Promise<Array>} Array of chat messages sorted chronologically
   */
  async fetchChatHistory(personalityId, personalityName, authData) {
    logger.info(`[BackupAPIClient] Fetching chat history for ${personalityName}...`);

    const allMessages = [];
    let beforeTs = null;
    let iteration = 0;
    const CHAT_BATCH_SIZE = 50;

    try {
      while (true) {
        iteration++;
        const jargonTerm = getPersonalityJargonTerm();
        if (!jargonTerm) {
          throw new Error('PERSONALITY_JARGON_TERM environment variable not configured');
        }
        let url = `${this.apiBaseUrl}/${jargonTerm}/${personalityId}/chat/history?limit=${CHAT_BATCH_SIZE}&shape_id=${personalityId}`;

        if (beforeTs) {
          url += `&before_ts=${beforeTs}`;
        }

        logger.info(
          `[BackupAPIClient] Fetching chat batch ${iteration}${beforeTs ? ` (before ${new Date(beforeTs * 1000).toISOString()})` : ''}...`
        );

        const messages = await this._makeAuthenticatedRequest(url, authData);

        if (!Array.isArray(messages) || messages.length === 0) {
          logger.info(`[BackupAPIClient] No more messages found`);
          break;
        }

        allMessages.push(...messages);
        logger.info(
          `[BackupAPIClient] Retrieved ${messages.length} messages (total: ${allMessages.length})`
        );

        // Find earliest timestamp for next batch
        beforeTs = Math.min(...messages.map(m => m.ts));
      }

      // Sort by timestamp (oldest first)
      allMessages.sort((a, b) => a.ts - b.ts);

      logger.info(`[BackupAPIClient] Fetched ${allMessages.length} total chat messages`);
      return allMessages;
    } catch (error) {
      logger.error(`[BackupAPIClient] Error fetching chat history: ${error.message}`);
      return [];
    }
  }

  /**
   * Make authenticated request to API
   * @private
   * @param {string} url - Request URL
   * @param {Object} authData - Authentication data
   * @returns {Promise<Object>} Response data
   */
  async _makeAuthenticatedRequest(url, authData) {
    const controller = new AbortController();
    const timeoutId = this.scheduler(() => controller.abort(), this.timeout);

    try {
      const headers = {
        'User-Agent': 'Tzurot Discord Bot Backup/2.0',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      // Session cookie is required for backup operations
      if (!authData.cookie) {
        throw new Error('Session cookie required for backup operations');
      }

      headers['Cookie'] = authData.cookie;
      logger.debug(`[BackupAPIClient] Using session cookie for authentication`);

      const response = await this.fetch(url, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = new Error(`API error ${response.status}: ${response.statusText}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    } finally {
      this.clearScheduler(timeoutId);
    }
  }

  /**
   * Get default API base URL
   * @private
   */
  _getDefaultApiBaseUrl() {
    const serviceWebsite = process.env.SERVICE_WEBSITE;
    return serviceWebsite ? `${serviceWebsite}/api` : null;
  }
}

module.exports = {
  BackupAPIClient,
};
