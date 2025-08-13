/**
 * TrimWhitespaceStep
 * 
 * Cleans up excessive whitespace in message content.
 * Removes leading/trailing spaces and collapses multiple spaces.
 */

const FormattingStep = require('../FormattingStep');

class TrimWhitespaceStep extends FormattingStep {
  /**
   * Execute whitespace trimming
   * @param {string} content - The message content
   * @param {Object} context - The formatting context
   * @returns {string} Content with cleaned whitespace
   */
  execute(content, context) {
    if (!content || typeof content !== 'string') {
      return content || '';
    }

    // Trim leading/trailing whitespace
    let trimmed = content.trim();
    
    // Collapse multiple spaces into single spaces
    trimmed = trimmed.replace(/\s{2,}/g, ' ');
    
    // Collapse multiple newlines into double newlines (preserve paragraph breaks)
    trimmed = trimmed.replace(/\n{3,}/g, '\n\n');
    
    // Clean up spaces before punctuation
    trimmed = trimmed.replace(/\s+([.,!?;:])/g, '$1');
    
    // Clean up spaces around quotes
    trimmed = trimmed.replace(/\s*"\s*/g, '"');
    trimmed = trimmed.replace(/\s*'\s*/g, "'");
    
    return trimmed;
  }

  /**
   * Get the name of this step
   * @returns {string}
   */
  getName() {
    return 'TrimWhitespaceStep';
  }
}

module.exports = TrimWhitespaceStep;