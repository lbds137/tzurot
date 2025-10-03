/**
 * AI Content value object
 * @module domain/ai/AIContent
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class AIContent
 * @extends ValueObject
 * @description Represents content for AI request/response
 */
class AIContent extends ValueObject {
  constructor(items = []) {
    super();

    if (!Array.isArray(items)) {
      throw new Error('AIContent must be initialized with an array');
    }

    this.items = Object.freeze(items.map(item => this.validateItem(item)));
    this.freeze();
  }

  /**
   * Validate and normalize content item
   * @private
   * @param {Object} item - Content item
   * @returns {Object} Validated item
   */
  validateItem(item) {
    if (!item || typeof item !== 'object') {
      throw new Error('Content item must be an object');
    }

    const validTypes = ['text', 'image_url', 'audio_url'];
    if (!validTypes.includes(item.type)) {
      throw new Error(`Invalid content type: ${item.type}`);
    }

    switch (item.type) {
      case 'text':
        if (!item.text || typeof item.text !== 'string') {
          throw new Error('Text content must have text property');
        }
        return { type: 'text', text: item.text };

      case 'image_url':
        if (!item.image_url?.url) {
          throw new Error('Image content must have image_url.url');
        }
        return { type: 'image_url', image_url: { url: item.image_url.url } };

      case 'audio_url':
        if (!item.audio_url?.url) {
          throw new Error('Audio content must have audio_url.url');
        }
        return { type: 'audio_url', audio_url: { url: item.audio_url.url } };

      default:
        throw new Error(`Unsupported content type: ${item.type}`);
    }
  }

  /**
   * Create content from plain text
   * @static
   * @param {string} text - Text content
   * @returns {AIContent} Content instance
   */
  static fromText(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Text must be a non-empty string');
    }

    return new AIContent([{ type: 'text', text }]);
  }

  /**
   * Add text to content
   * @param {string} text - Text to add
   * @returns {AIContent} New content instance
   */
  addText(text) {
    return new AIContent([...this.items, { type: 'text', text }]);
  }

  /**
   * Add image to content
   * @param {string} url - Image URL
   * @returns {AIContent} New content instance
   */
  addImage(url) {
    return new AIContent([...this.items, { type: 'image_url', image_url: { url } }]);
  }

  /**
   * Add audio to content
   * @param {string} url - Audio URL
   * @returns {AIContent} New content instance
   */
  addAudio(url) {
    return new AIContent([...this.items, { type: 'audio_url', audio_url: { url } }]);
  }

  /**
   * Check if content has media
   * @returns {boolean} True if has images or audio
   */
  hasMedia() {
    return this.items.some(item => item.type === 'image_url' || item.type === 'audio_url');
  }

  /**
   * Check if content has audio
   * @returns {boolean} True if has audio
   */
  hasAudio() {
    return this.items.some(item => item.type === 'audio_url');
  }

  /**
   * Get text content only
   * @returns {string} Combined text content
   */
  getText() {
    return this.items
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n');
  }

  /**
   * Check if content is empty
   * @returns {boolean} True if no content
   */
  isEmpty() {
    return this.items.length === 0;
  }

  toJSON() {
    return this.items;
  }
}

module.exports = { AIContent };
