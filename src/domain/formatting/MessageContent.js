/**
 * MessageContent Value Object
 * 
 * Encapsulates message content and provides methods for common operations.
 * Immutable - all methods return new instances.
 */

class MessageContent {
  constructor(content) {
    if (typeof content !== 'string') {
      throw new Error('MessageContent must be initialized with a string');
    }
    this._content = content;
    Object.freeze(this);
  }

  /**
   * Get the raw content string
   * @returns {string}
   */
  toString() {
    return this._content;
  }

  /**
   * Get the content value
   * @returns {string}
   */
  getValue() {
    return this._content;
  }

  /**
   * Get the length of the content
   * @returns {number}
   */
  get length() {
    return this._content.length;
  }

  /**
   * Check if content is empty or only whitespace
   * @returns {boolean}
   */
  isEmpty() {
    return this._content.trim().length === 0;
  }

  /**
   * Check if content exceeds Discord's message limit
   * @returns {boolean}
   */
  exceedsDiscordLimit() {
    return this._content.length > 2000;
  }

  /**
   * Create a new MessageContent with transformed content
   * @param {Function} transformer - Function that transforms the content string
   * @returns {MessageContent}
   */
  transform(transformer) {
    if (typeof transformer !== 'function') {
      throw new Error('Transformer must be a function');
    }
    return new MessageContent(transformer(this._content));
  }

  /**
   * Create a new MessageContent with a prefix added
   * @param {string} prefix
   * @returns {MessageContent}
   */
  withPrefix(prefix) {
    return new MessageContent(prefix + this._content);
  }

  /**
   * Create a new MessageContent with a suffix added
   * @param {string} suffix
   * @returns {MessageContent}
   */
  withSuffix(suffix) {
    return new MessageContent(this._content + suffix);
  }

  /**
   * Create a new MessageContent with trimmed whitespace
   * @returns {MessageContent}
   */
  trim() {
    return new MessageContent(this._content.trim());
  }

  /**
   * Split content into chunks that fit within Discord's limit
   * @param {number} maxLength - Maximum length per chunk (default 2000)
   * @returns {MessageContent[]}
   */
  split(maxLength = 2000) {
    if (this._content.length <= maxLength) {
      return [this];
    }

    const chunks = [];
    let currentChunk = '';
    
    // Try to split on newlines first
    const lines = this._content.split('\n');
    
    for (const line of lines) {
      if ((currentChunk + '\n' + line).length > maxLength) {
        if (currentChunk) {
          chunks.push(new MessageContent(currentChunk));
          currentChunk = line;
        } else {
          // Single line exceeds limit, split it
          let remaining = line;
          while (remaining.length > maxLength) {
            chunks.push(new MessageContent(remaining.substring(0, maxLength)));
            remaining = remaining.substring(maxLength);
          }
          currentChunk = remaining;
        }
      } else {
        currentChunk = currentChunk ? currentChunk + '\n' + line : line;
      }
    }
    
    if (currentChunk) {
      chunks.push(new MessageContent(currentChunk));
    }
    
    return chunks;
  }

  /**
   * Check if content contains a mention pattern
   * @param {string} pattern - The mention pattern to check for
   * @returns {boolean}
   */
  containsMention(pattern) {
    return this._content.includes(pattern);
  }

  /**
   * Remove mention patterns from content
   * @param {string|RegExp} pattern - The pattern to remove
   * @returns {MessageContent}
   */
  removeMention(pattern) {
    const newContent = this._content.replace(pattern, '').trim();
    return new MessageContent(newContent);
  }

  /**
   * Equality check
   * @param {MessageContent} other
   * @returns {boolean}
   */
  equals(other) {
    return other instanceof MessageContent && this._content === other._content;
  }
}

module.exports = MessageContent;