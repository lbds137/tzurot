/**
 * FormattingPipeline
 * 
 * Orchestrates the execution of formatting steps in a defined order.
 * Provides a clear, traceable path for how message content is transformed.
 */

const MessageContent = require('./MessageContent');
const FormattingStep = require('./FormattingStep');

class FormattingPipeline {
  constructor(options = {}) {
    this.steps = [];
    this.logger = options.logger || console;
    this.debug = options.debug || false;
  }

  /**
   * Add a formatting step to the pipeline
   * @param {FormattingStep} step
   * @returns {FormattingPipeline} Returns this for chaining
   */
  addStep(step) {
    if (!(step instanceof FormattingStep)) {
      throw new Error('Step must be an instance of FormattingStep');
    }
    this.steps.push(step);
    return this;
  }

  /**
   * Remove a step by name
   * @param {string} stepName
   * @returns {FormattingPipeline} Returns this for chaining
   */
  removeStep(stepName) {
    this.steps = this.steps.filter(step => step.getName() !== stepName);
    return this;
  }

  /**
   * Clear all steps
   * @returns {FormattingPipeline} Returns this for chaining
   */
  clearSteps() {
    this.steps = [];
    return this;
  }

  /**
   * Get all step names in order
   * @returns {string[]}
   */
  getStepNames() {
    return this.steps.map(step => step.getName());
  }

  /**
   * Execute the pipeline on the given content
   * @param {string|MessageContent} content - The content to format
   * @param {Object} context - Context for formatting
   * @returns {MessageContent} The formatted content
   */
  execute(content, context = {}) {
    // Ensure we have a MessageContent object
    let messageContent = content instanceof MessageContent 
      ? content 
      : new MessageContent(content || '');

    if (this.debug) {
      this.logger.debug('[FormattingPipeline] Starting pipeline with content:', messageContent.getValue());
      this.logger.debug('[FormattingPipeline] Steps to execute:', this.getStepNames());
    }

    // Execute each step in order
    for (const step of this.steps) {
      try {
        // Check if step should execute
        if (!step.shouldExecute(context)) {
          if (this.debug) {
            this.logger.debug(`[FormattingPipeline] Skipping step: ${step.getName()}`);
          }
          continue;
        }

        if (this.debug) {
          this.logger.debug(`[FormattingPipeline] Executing step: ${step.getName()}`);
        }

        // Execute the step
        const rawContent = messageContent.getValue();
        const formattedContent = step.execute(rawContent, context);
        
        // Create new MessageContent with the result
        messageContent = new MessageContent(formattedContent);

        if (this.debug) {
          this.logger.debug(`[FormattingPipeline] After ${step.getName()}:`, messageContent.getValue());
        }
      } catch (error) {
        this.logger.error(`[FormattingPipeline] Error in step ${step.getName()}:`, error);
        // Continue with the current content if a step fails
      }
    }

    if (this.debug) {
      this.logger.debug('[FormattingPipeline] Pipeline complete. Final content:', messageContent.getValue());
    }

    return messageContent;
  }

  /**
   * Execute the pipeline and split into chunks if needed
   * @param {string|MessageContent} content
   * @param {Object} context
   * @param {number} maxLength - Maximum length per chunk
   * @returns {MessageContent[]} Array of formatted content chunks
   */
  executeAndSplit(content, context = {}, maxLength = 2000) {
    const formatted = this.execute(content, context);
    return formatted.split(maxLength);
  }

  /**
   * Create a copy of this pipeline
   * @returns {FormattingPipeline}
   */
  clone() {
    const cloned = new FormattingPipeline({
      logger: this.logger,
      debug: this.debug
    });
    this.steps.forEach(step => cloned.addStep(step));
    return cloned;
  }

  /**
   * Create a pipeline from a configuration object
   * @param {Object} config
   * @param {FormattingStep[]} config.steps - Array of step instances
   * @param {Object} config.options - Pipeline options
   * @returns {FormattingPipeline}
   */
  static fromConfig(config) {
    const pipeline = new FormattingPipeline(config.options || {});
    
    if (config.steps && Array.isArray(config.steps)) {
      config.steps.forEach(step => pipeline.addStep(step));
    }
    
    return pipeline;
  }
}

module.exports = FormattingPipeline;
