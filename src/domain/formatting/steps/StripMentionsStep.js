/**
 * StripMentionsStep
 * 
 * Removes personality mentions from message content.
 * This prevents the AI from seeing "@personality" in the messages,
 * which could confuse it or cause it to respond incorrectly.
 */

const FormattingStep = require('../FormattingStep');

class StripMentionsStep extends FormattingStep {
  constructor(options = {}) {
    super();
    // Default to @ but allow configuration for different environments
    this.mentionChar = options.mentionChar || '@';
    this.logger = options.logger || console;
    
    // Function to resolve if a name is a valid personality/alias
    // This should be injected to avoid coupling to specific implementation
    this.resolvePersonality = options.resolvePersonality || (() => null);
    
    // Maximum words to check for multi-word aliases
    this.maxAliasWordCount = options.maxAliasWordCount || 5;
  }

  /**
   * Execute the mention stripping
   * @param {string} content - The message content
   * @param {Object} context - The formatting context
   * @returns {string} Content with mentions removed
   */
  execute(content, context) {
    if (!content || typeof content !== 'string') {
      return content || '';
    }

    let strippedContent = content;
    
    // Escape the mention character for regex safety
    const escapedMentionChar = this.mentionChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Store found mentions for logging
    const foundMentions = [];
    
    // Combined pattern that handles both single and multi-word mentions
    // Matches @word or @word word word... (up to maxAliasWordCount)
    let pattern;
    if (this.maxAliasWordCount > 1) {
      // Pattern for multi-word mentions (also handles single-word)
      pattern = new RegExp(
        `${escapedMentionChar}([a-zA-Z0-9_-]+(?:\\s+[a-zA-Z0-9_-]+){0,${this.maxAliasWordCount - 1}})`,
        'gi'
      );
    } else {
      // Simple single-word pattern
      pattern = new RegExp(
        `${escapedMentionChar}([a-zA-Z0-9_-]+)`,
        'gi'
      );
    }
    
    // Replace all mentions
    strippedContent = strippedContent.replace(pattern, (match, words, offset, fullString) => {
      // Check if this is part of an email (has text before @ without space)
      if (offset > 0 && fullString[offset - 1].match(/[a-zA-Z0-9]/)) {
        return match; // Keep emails intact
      }
      
      // Check what comes after to ensure we don't over-capture
      const afterMatch = fullString.substring(offset + match.length);
      // If the next character continues the word (for single-word mentions)
      // we might have captured too much in a multi-word pattern
      // But for intentional multi-word mentions like "@cash money", this is fine
      
      foundMentions.push(match);
      return ''; // Remove the mention
    });
    
    // Clean up any resulting double spaces or leading/trailing spaces
    strippedContent = strippedContent.replace(/\s{2,}/g, ' ').trim();
    
    if (foundMentions.length > 0 && this.logger.debug) {
      this.logger.debug(`[StripMentionsStep] Removed mentions: ${foundMentions.join(', ')}`);
    }
    
    return strippedContent;
  }

  /**
   * Get the name of this step
   * @returns {string}
   */
  getName() {
    return 'StripMentionsStep';
  }
}

module.exports = StripMentionsStep;