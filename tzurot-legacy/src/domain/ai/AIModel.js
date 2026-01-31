/**
 * AI Model value object
 * @module domain/ai/AIModel
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class AIModel
 * @extends ValueObject
 * @description Represents an AI model configuration
 */
class AIModel extends ValueObject {
  constructor(name, path, capabilities = {}) {
    super();

    if (!name || typeof name !== 'string') {
      throw new Error('Model name required');
    }

    if (!path || typeof path !== 'string') {
      throw new Error('Model path required');
    }

    this.name = name;
    this.path = path;
    this.capabilities = Object.freeze({
      supportsImages: capabilities.supportsImages || false,
      supportsAudio: capabilities.supportsAudio || false,
      maxTokens: capabilities.maxTokens || 4096,
      temperature: capabilities.temperature || 0.7,
    });
    this.freeze();
  }

  /**
   * Check if model supports specific content type
   * @param {string} contentType - Content type to check
   * @returns {boolean} True if supported
   */
  supports(contentType) {
    switch (contentType) {
      case 'image':
        return this.capabilities.supportsImages;
      case 'audio':
        return this.capabilities.supportsAudio;
      case 'text':
        return true; // All models support text
      default:
        return false;
    }
  }

  /**
   * Check if content is compatible with model
   * @param {AIContent} content - Content to check
   * @returns {boolean} True if compatible
   */
  isCompatibleWith(content) {
    if (!content || !content.items) {
      return true;
    }

    for (const item of content.items) {
      if (item.type === 'image_url' && !this.capabilities.supportsImages) {
        return false;
      }
      if (item.type === 'audio_url' && !this.capabilities.supportsAudio) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get request parameters for this model
   * @returns {Object} Model parameters
   */
  getParameters() {
    return {
      model: this.path,
      max_tokens: this.capabilities.maxTokens,
      temperature: this.capabilities.temperature,
    };
  }

  toJSON() {
    return {
      name: this.name,
      path: this.path,
      capabilities: this.capabilities,
    };
  }

  /**
   * Create default model
   * @static
   * @returns {AIModel} Default model
   */
  static createDefault() {
    return new AIModel('default', 'claude-3-opus-20240229', {
      supportsImages: true,
      supportsAudio: true,
      maxTokens: 4096,
      temperature: 0.7,
    });
  }

  /**
   * Create AIModel from JSON
   * @param {Object} json - JSON representation
   * @returns {AIModel} New AIModel instance
   */
  static fromJSON(json) {
    return new AIModel(json.name, json.path, json.capabilities);
  }
}

module.exports = { AIModel };
