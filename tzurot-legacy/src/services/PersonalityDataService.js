/**
 * Service for unified access to personality data with automatic migration
 * @module services/PersonalityDataService
 */

const logger = require('../logger');
const { PersonalityDataRepository } = require('../domain/personality/PersonalityDataRepository');
const { PersonalityProfile } = require('../domain/personality/PersonalityProfile');

/**
 * @class PersonalityDataService
 * @description Provides unified access to personality data with automatic migration from backups
 */
class PersonalityDataService {
  constructor(repository = null) {
    this.repository = repository || new PersonalityDataRepository();
    this.contextCache = new Map(); // Cache for active conversation contexts
  }

  /**
   * Get personality profile with extended data if available
   * @param {string} personalityName - Name of the personality
   * @param {Object} basicProfile - Basic PersonalityProfile if already loaded
   * @returns {Promise<PersonalityProfile|ExtendedPersonalityProfile>}
   */
  async getEnhancedProfile(personalityName, basicProfile = null) {
    try {
      // Check if we have extended data
      const extendedProfile = await this.repository.getExtendedProfile(personalityName);

      if (extendedProfile) {
        logger.info(`[PersonalityDataService] Using extended profile for ${personalityName}`);
        return extendedProfile;
      }

      // Return basic profile if no extended data
      return basicProfile;
    } catch (error) {
      logger.error(`[PersonalityDataService] Error getting enhanced profile: ${error.message}`);
      return basicProfile;
    }
  }

  /**
   * Check if personality has backup data available
   * @param {string} personalityName - Name of the personality
   * @returns {Promise<boolean>}
   */
  async hasBackupData(personalityName) {
    return await this.repository.hasExtendedData(personalityName);
  }

  /**
   * Get conversation context for AI, including relevant chat history
   * @param {string} personalityName - Name of the personality
   * @param {string} userId - Discord user ID
   * @param {Object} options - Context options
   * @returns {Promise<Object>}
   */
  async getConversationContext(personalityName, userId, options = {}) {
    const {
      includeHistory = true,
      historyLimit = 10,
      includeMemories = true,
      includeKnowledge = true,
    } = options;

    const context = {
      history: [],
      memories: [],
      knowledge: [],
      metadata: {},
    };

    try {
      // Get recent chat history
      if (includeHistory) {
        const chatHistory = await this.repository.getChatHistory(personalityName, {
          userId,
          limit: historyLimit,
        });

        // Format chat history for AI context
        context.history = chatHistory.map(msg => ({
          role: msg.message ? 'user' : 'assistant',
          content: msg.message || msg.reply,
          timestamp: msg.ts,
          metadata: {
            hasVoice: !!msg.voice_reply_url,
            hasAttachment: !!msg.attachment_url,
            attachmentType: msg.attachment_type,
          },
        }));
      }

      // Get relevant memories
      if (includeMemories) {
        const memories = await this.repository.getMemories(personalityName);
        // For now, include all memories - in future, implement semantic search
        context.memories = memories.slice(0, 5); // Limit to most recent 5
      }

      // Get knowledge/story data
      if (includeKnowledge) {
        const knowledge = await this.repository.getKnowledge(personalityName);
        // For now, include all knowledge - in future, implement RAG
        context.knowledge = knowledge.slice(0, 3); // Limit to 3 items
      }

      // Add metadata
      const hasBackup = await this.hasBackupData(personalityName);
      context.metadata = {
        hasExtendedData: hasBackup,
        contextSources: {
          history: context.history.length > 0,
          memories: context.memories.length > 0,
          knowledge: context.knowledge.length > 0,
        },
      };

      return context;
    } catch (error) {
      logger.error(`[PersonalityDataService] Error getting conversation context: ${error.message}`);
      return context;
    }
  }

  /**
   * Build AI prompt with context
   * @param {string} personalityName - Name of the personality
   * @param {string} userId - Discord user ID
   * @param {string|Array|Object} userMessage - Current user message (can be text, array of content, or complex object)
   * @param {Object} profile - Personality profile
   * @returns {Promise<Object>}
   */
  async buildContextualPrompt(personalityName, userId, userMessage, profile) {
    const context = await this.getConversationContext(personalityName, userId);

    // Get extended profile if available
    const extendedProfile = await this.repository.getExtendedProfile(personalityName);

    // Build system prompt with context
    let systemPrompt = '';
    if (extendedProfile) {
      systemPrompt = extendedProfile.userPrompt || extendedProfile.prompt || '';

      // Add jailbreak prompt if available
      if (extendedProfile.jailbreakPrompt) {
        systemPrompt += '\n\n' + extendedProfile.jailbreakPrompt;
      }
    } else {
      systemPrompt = profile.prompt || profile.userPrompt || '';
    }

    // Add knowledge context if available
    if (context.knowledge.length > 0) {
      systemPrompt += '\n\n## Background Knowledge\n';
      context.knowledge.forEach((item, index) => {
        systemPrompt += `${index + 1}. ${item.content || item.text || JSON.stringify(item)}\n`;
      });
    }

    // Add memory context if available
    if (context.memories.length > 0) {
      systemPrompt += '\n\n## Relevant Memories\n';
      context.memories.forEach((memory, index) => {
        const timestamp = memory.created_at
          ? new Date(memory.created_at * 1000).toISOString()
          : 'Unknown';
        systemPrompt += `${index + 1}. [${timestamp}] ${memory.content || memory.text || JSON.stringify(memory)}\n`;
      });
    }

    // Build conversation messages
    const messages = [{ role: 'system', content: systemPrompt }];

    // Add recent conversation history
    if (context.history.length > 0) {
      // Reverse to get chronological order (oldest first)
      const chronologicalHistory = [...context.history].reverse();
      messages.push(
        ...chronologicalHistory.map(msg => ({
          role: msg.role,
          content: msg.content,
        }))
      );
    }

    // Add current message (handle complex formats)
    if (typeof userMessage === 'string') {
      messages.push({ role: 'user', content: userMessage });
    } else if (Array.isArray(userMessage)) {
      messages.push({ role: 'user', content: userMessage });
    } else if (userMessage && typeof userMessage === 'object') {
      // Handle complex message objects
      messages.push({ role: 'user', content: userMessage });
    }

    return {
      messages,
      context,
      hasExtendedContext: context.metadata.hasExtendedData,
    };
  }

  /**
   * Store a new message in the conversation history
   * @param {string} personalityName - Name of the personality
   * @param {string} userId - Discord user ID
   * @param {Object} message - Message data
   */
  async addToConversationHistory(personalityName, userId, message) {
    // For now, this is a placeholder - in future, we'll store in STM
    const cacheKey = `${personalityName}:${userId}`;

    if (!this.contextCache.has(cacheKey)) {
      this.contextCache.set(cacheKey, []);
    }

    const history = this.contextCache.get(cacheKey);
    history.push({
      ...message,
      ts: Date.now() / 1000,
    });

    // Keep only last 50 messages (STM limit)
    if (history.length > 50) {
      history.shift();
    }

    logger.debug(`[PersonalityDataService] Added message to context cache for ${personalityName}`);
  }

  /**
   * Clear context cache for a personality or all
   * @param {string} [personalityName] - Name of personality to clear, or null for all
   */
  clearContextCache(personalityName = null) {
    if (personalityName) {
      // Clear specific personality contexts
      for (const [key] of this.contextCache) {
        if (key.startsWith(`${personalityName}:`)) {
          this.contextCache.delete(key);
        }
      }
    } else {
      this.contextCache.clear();
    }
  }
}

// Singleton instance
let instance = null;

/**
 * Get or create the PersonalityDataService instance
 * @returns {PersonalityDataService}
 */
function getPersonalityDataService() {
  if (!instance) {
    instance = new PersonalityDataService();
  }
  return instance;
}

module.exports = { PersonalityDataService, getPersonalityDataService };
