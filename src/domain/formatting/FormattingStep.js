/**
 * FormattingStep Interface
 * 
 * Defines the contract that all formatting steps must implement.
 * Each step is responsible for a single transformation of message content.
 */

class FormattingStep {
  /**
   * Execute the formatting step on the given content
   * 
   * @param {string} content - The message content to format
   * @param {Object} context - Additional context for formatting
   * @param {Object} context.message - The original Discord message object
   * @param {Object} context.personality - The personality being responded as
   * @param {Object} context.preferences - User preferences (e.g., voice toggle)
   * @param {Object} context.metadata - Additional metadata
   * @returns {string} The formatted content
   */
  execute(content, context) {
    throw new Error('FormattingStep.execute() must be implemented by subclass');
  }

  /**
   * Get a descriptive name for this formatting step
   * Used for debugging and logging
   * 
   * @returns {string} The step name
   */
  getName() {
    return this.constructor.name;
  }

  /**
   * Check if this step should be executed given the context
   * Allows steps to be conditionally applied
   * 
   * @param {Object} context - The formatting context
   * @returns {boolean} Whether to execute this step
   */
  shouldExecute(context) {
    return true;
  }
}

module.exports = FormattingStep;