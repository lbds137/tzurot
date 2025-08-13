/**
 * MessageFormattingService
 * 
 * Application service that provides a simple API for message formatting.
 * This is the integration point between the legacy code and the new formatting domain.
 */

const { FormattingPipeline, MessageContent } = require('../../domain/formatting');
const StripMentionsStep = require('../../domain/formatting/steps/StripMentionsStep');
const TrimWhitespaceStep = require('../../domain/formatting/steps/TrimWhitespaceStep');
const AddContextMetadataStep = require('../../domain/formatting/steps/AddContextMetadataStep');

class MessageFormattingService {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.mentionChar = options.mentionChar || '@';
    this.maxAliasWordCount = options.maxAliasWordCount || 5;
    this.resolvePersonality = options.resolvePersonality || null;
    
    // Create the default pipeline
    this.pipeline = this.createDefaultPipeline();
    
    // Store custom pipelines for specific personalities
    this.customPipelines = new Map();
  }

  /**
   * Create the default formatting pipeline
   * @returns {FormattingPipeline}
   */
  createDefaultPipeline() {
    const pipeline = new FormattingPipeline({
      logger: this.logger,
      debug: false
    });

    // Add steps in order
    pipeline.addStep(new StripMentionsStep({
      mentionChar: this.mentionChar,
      maxAliasWordCount: this.maxAliasWordCount,
      resolvePersonality: this.resolvePersonality,
      logger: this.logger
    }));
    
    pipeline.addStep(new TrimWhitespaceStep());
    
    pipeline.addStep(new AddContextMetadataStep({
      logger: this.logger,
      position: 'prepend'
    }));

    return pipeline;
  }

  /**
   * Format a message for sending to the AI
   * @param {string} content - The message content to format
   * @param {Object} context - Context for formatting
   * @param {Object} context.message - Discord message object
   * @param {Object} context.personality - Personality being used
   * @param {Object} context.preferences - User preferences
   * @returns {string} Formatted message content
   */
  formatMessage(content, context = {}) {
    try {
      // Select the appropriate pipeline
      const pipeline = this.getPipelineForContext(context);
      
      // Execute the pipeline
      const result = pipeline.execute(content, context);
      
      // Return the string value
      return result instanceof MessageContent ? result.getValue() : result;
    } catch (error) {
      this.logger.error('[MessageFormattingService] Error formatting message:', error);
      // Return original content on error
      return content || '';
    }
  }

  /**
   * Format a message and split if needed
   * @param {string} content - The message content
   * @param {Object} context - Formatting context
   * @param {number} maxLength - Maximum length per chunk
   * @returns {string[]} Array of formatted message chunks
   */
  formatAndSplit(content, context = {}, maxLength = 2000) {
    try {
      const pipeline = this.getPipelineForContext(context);
      const chunks = pipeline.executeAndSplit(content, context, maxLength);
      
      // Convert MessageContent objects to strings
      return chunks.map(chunk => 
        chunk instanceof MessageContent ? chunk.getValue() : chunk
      );
    } catch (error) {
      this.logger.error('[MessageFormattingService] Error formatting and splitting:', error);
      // Return original content as single chunk on error
      return [content || ''];
    }
  }

  /**
   * Get the appropriate pipeline for the given context
   * @param {Object} context
   * @returns {FormattingPipeline}
   */
  getPipelineForContext(context) {
    // Check if there's a custom pipeline for this personality
    if (context.personality && context.personality.name) {
      const customPipeline = this.customPipelines.get(context.personality.name);
      if (customPipeline) {
        return customPipeline;
      }
    }
    
    // Use default pipeline
    return this.pipeline;
  }

  /**
   * Register a custom pipeline for a specific personality
   * @param {string} personalityName
   * @param {FormattingPipeline} pipeline
   */
  registerCustomPipeline(personalityName, pipeline) {
    if (!personalityName || !pipeline) {
      throw new Error('Both personalityName and pipeline are required');
    }
    
    this.customPipelines.set(personalityName, pipeline);
    
    if (this.logger.debug) {
      this.logger.debug(`[MessageFormattingService] Registered custom pipeline for ${personalityName}`);
    }
  }

  /**
   * Add a step to the default pipeline
   * @param {FormattingStep} step
   */
  addStep(step) {
    this.pipeline.addStep(step);
  }

  /**
   * Remove a step from the default pipeline by name
   * @param {string} stepName
   */
  removeStep(stepName) {
    this.pipeline.removeStep(stepName);
  }

  /**
   * Get the list of step names in the default pipeline
   * @returns {string[]}
   */
  getStepNames() {
    return this.pipeline.getStepNames();
  }

  /**
   * Update configuration
   * @param {Object} config
   */
  updateConfig(config) {
    if (config.mentionChar !== undefined) {
      this.mentionChar = config.mentionChar;
    }
    
    if (config.maxAliasWordCount !== undefined) {
      this.maxAliasWordCount = config.maxAliasWordCount;
    }
    
    if (config.resolvePersonality !== undefined) {
      this.resolvePersonality = config.resolvePersonality;
    }
    
    // Recreate the pipeline with new config
    this.pipeline = this.createDefaultPipeline();
  }

  /**
   * Create a custom pipeline with specific steps
   * @param {FormattingStep[]} steps
   * @returns {FormattingPipeline}
   */
  createCustomPipeline(steps) {
    const pipeline = new FormattingPipeline({
      logger: this.logger,
      debug: false
    });
    
    steps.forEach(step => pipeline.addStep(step));
    
    return pipeline;
  }
}

module.exports = MessageFormattingService;