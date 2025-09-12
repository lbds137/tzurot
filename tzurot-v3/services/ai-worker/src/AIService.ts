import { 
  AIProviderFactory,
  ChatCompletionRequest,
  ChatMessage 
} from '@tzurot/api-clients';
import { 
  Personality,
  ConversationHistory,
  MessageContent,
  getConfig 
} from '@tzurot/common-types';
import { pino } from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

interface AIRequestContext {
  userId?: string;
  channelId?: string;
  userName?: string;
  isProxyMessage?: boolean;
  conversationHistory?: ConversationHistory;
  webhookId?: string;
}

interface AIResponse {
  content: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

interface PendingRequest {
  promise: Promise<AIResponse>;
  timestamp: number;
}

export class AIService {
  private pendingRequests = new Map<string, PendingRequest>();
  private blackoutPeriods = new Map<string, number>();
  private readonly blackoutDuration = 5 * 60 * 1000; // 5 minutes
  private readonly requestTimeout = 30000; // 30 seconds

  constructor() {
    // Clean up old pending requests periodically
    setInterval(() => this.cleanupPendingRequests(), 60000);
  }

  /**
   * Generate AI response for a personality
   */
  async generateResponse(
    personality: Personality,
    message: MessageContent,
    context: AIRequestContext = {}
  ): Promise<AIResponse> {
    const requestId = this.createRequestId(personality.name, message, context);
    
    // Check for duplicate requests
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      logger.info(`[AIService] Reusing pending request for ${personality.name}`);
      return pending.promise;
    }

    // Check blackout period
    if (this.isInBlackout(personality.name, context)) {
      logger.warn(`[AIService] ${personality.name} is in blackout period`);
      return {
        content: "I'm temporarily unavailable. Please try again in a few minutes.",
        error: 'BLACKOUT_PERIOD'
      };
    }

    // Create the promise for this request
    const responsePromise = this.executeRequest(personality, message, context);
    
    // Store to prevent duplicates
    this.pendingRequests.set(requestId, {
      promise: responsePromise,
      timestamp: Date.now()
    });

    // Clean up when done
    responsePromise.finally(() => {
      this.pendingRequests.delete(requestId);
    });

    return responsePromise;
  }

  /**
   * Execute the actual AI request
   */
  private async executeRequest(
    personality: Personality,
    message: MessageContent,
    context: AIRequestContext
  ): Promise<AIResponse> {
    try {
      // Build messages array for the AI
      const messages = await this.buildMessages(personality, message, context);
      
      // Get the AI provider
      const provider = AIProviderFactory.fromEnv();
      
      // Make the request
      const request: ChatCompletionRequest = {
        model: personality.model || getConfig().DEFAULT_AI_MODEL,
        messages,
        temperature: personality.temperature,
        max_tokens: personality.maxTokens,
        // Add user context for provider-specific handling
        user: context.userId
      };

      logger.info(`[AIService] Requesting completion for ${personality.name}`);
      
      // Use timeout wrapper
      const response = await this.withTimeout(
        provider.complete(request),
        this.requestTimeout
      );

      // Validate response
      if (!response?.choices?.[0]?.message?.content) {
        throw new Error('Invalid response structure from AI provider');
      }

      const content = response.choices[0].message.content;
      
      // Check for error-like responses
      if (this.isErrorResponse(content)) {
        throw new Error(`AI returned error-like response: ${content.substring(0, 100)}`);
      }

      logger.info(`[AIService] Generated ${content.length} chars for ${personality.name}`);
      
      return {
        content,
        metadata: response.usage as Record<string, unknown>
      };

    } catch (error) {
      logger.error(`[AIService] Error generating response for ${personality.name}:`, error);
      
      // Add to blackout if this is a rate limit or server error
      if (this.shouldBlackout(error)) {
        this.addToBlackout(personality.name, context);
      }

      // Return error response
      return {
        content: this.getErrorMessage(error, personality),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Build the messages array for the AI request
   */
  private async buildMessages(
    personality: Personality,
    message: MessageContent,
    context: AIRequestContext
  ): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];

    // Add system prompt
    messages.push({
      role: 'system',
      content: personality.systemPrompt
    });

    // Add conversation history if available
    if (context.conversationHistory && personality.memoryEnabled) {
      const historyLimit = personality.contextWindow || 10;
      const history = context.conversationHistory.messages.slice(-historyLimit);
      
      for (const msg of history) {
        messages.push({
          role: msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'system',
          content: msg.content
        });
      }
    }

    // Format the current message
    const userMessage = this.formatUserMessage(message, context);
    messages.push({
      role: 'user',
      content: userMessage
    });

    return messages;
  }

  /**
   * Format user message with context
   */
  private formatUserMessage(
    message: MessageContent,
    context: AIRequestContext
  ): string {
    let formatted = '';

    // Add context if this is a proxy message
    if (context.isProxyMessage && context.userName) {
      formatted += `[Message from ${context.userName}]\n`;
    }

    // Handle different message types
    if (typeof message === 'string') {
      formatted += message;
    } else if (typeof message === 'object' && message !== null) {
      // Handle complex message objects (with references, attachments, etc.)
      if ('content' in message) {
        formatted += message.content;
      }
      
      // Add reference context if available
      if ('referencedMessage' in message && message.referencedMessage) {
        const ref = message.referencedMessage;
        const author = ref.author || 'someone';
        formatted = `[Replying to ${author}: "${ref.content}"]\n${formatted}`;
      }

      // Note attachments if present
      if ('attachments' in message && Array.isArray(message.attachments)) {
        for (const attachment of message.attachments) {
          formatted += `\n[Attachment: ${attachment.name || 'file'}]`;
        }
      }
    }

    return formatted || 'Hello';
  }

  /**
   * Create unique request ID for deduplication
   */
  private createRequestId(
    personalityName: string,
    message: MessageContent,
    context: AIRequestContext
  ): string {
    const messageStr = typeof message === 'string' 
      ? message 
      : JSON.stringify(message);
    
    const contextStr = `${context.userId || 'anon'}-${context.channelId || 'dm'}`;
    const hash = this.simpleHash(`${personalityName}-${messageStr}-${contextStr}`);
    
    return `${personalityName}-${hash}`;
  }

  /**
   * Simple hash function for request IDs
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Check if personality/context is in blackout
   */
  private isInBlackout(personalityName: string, context: AIRequestContext): boolean {
    const key = this.getBlackoutKey(personalityName, context);
    const blackoutUntil = this.blackoutPeriods.get(key);
    
    if (!blackoutUntil) return false;
    
    if (Date.now() > blackoutUntil) {
      this.blackoutPeriods.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Add personality/context to blackout
   */
  private addToBlackout(personalityName: string, context: AIRequestContext): void {
    const key = this.getBlackoutKey(personalityName, context);
    this.blackoutPeriods.set(key, Date.now() + this.blackoutDuration);
    
    logger.warn(`[AIService] Added ${key} to blackout for ${this.blackoutDuration}ms`);
  }

  /**
   * Get blackout key for personality/context combo
   */
  private getBlackoutKey(personalityName: string, context: AIRequestContext): string {
    return `${personalityName}-${context.userId || 'anon'}-${context.channelId || 'dm'}`;
  }

  /**
   * Check if error should trigger blackout
   */
  private shouldBlackout(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    
    const message = error.message.toLowerCase();
    
    // Rate limits, server errors, timeouts
    return message.includes('rate limit') ||
           message.includes('429') ||
           message.includes('500') ||
           message.includes('502') ||
           message.includes('503') ||
           message.includes('timeout');
  }

  /**
   * Check if response looks like an error
   */
  private isErrorResponse(content: string): boolean {
    if (!content || content.length === 0) return true;
    
    const errorPatterns = [
      /^error:/i,
      /^sorry.*error/i,
      /^an error occurred/i,
      /^failed to/i,
      /internal server error/i,
      /something went wrong/i
    ];
    
    return errorPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Get user-friendly error message
   */
  private getErrorMessage(error: unknown, personality: Personality): string {
    if (!(error instanceof Error)) {
      return "I encountered an unexpected issue. Please try again.";
    }

    const message = error.message.toLowerCase();
    
    // Rate limit errors
    if (message.includes('rate limit') || message.includes('429')) {
      return "I'm receiving too many requests right now. Please try again in a moment.";
    }
    
    // Authentication errors
    if (message.includes('401') || message.includes('unauthorized')) {
      return "Authentication is required to use this service. Please authenticate first.";
    }
    
    // Timeout errors
    if (message.includes('timeout')) {
      return "The request took too long. Please try again with a shorter message.";
    }
    
    // Server errors
    if (message.includes('500') || message.includes('502') || message.includes('503')) {
      return "The AI service is temporarily unavailable. Please try again later.";
    }

    // Personality-specific error message if configured
    if (personality.errorMessage) {
      return personality.errorMessage;
    }
    
    // Generic fallback
    return "I couldn't generate a response right now. Please try again.";
  }

  /**
   * Add timeout to promise
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
    });
    
    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Clean up old pending requests
   */
  private cleanupPendingRequests(): void {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes
    
    for (const [id, request] of this.pendingRequests.entries()) {
      if (now - request.timestamp > maxAge) {
        logger.warn(`[AIService] Cleaning up stale request: ${id}`);
        this.pendingRequests.delete(id);
      }
    }
  }

  /**
   * Stream response for a personality (for future use)
   */
  async *streamResponse(
    personality: Personality,
    message: MessageContent,
    context: AIRequestContext = {}
  ): AsyncGenerator<string, void, unknown> {
    try {
      const messages = await this.buildMessages(personality, message, context);
      const provider = AIProviderFactory.fromEnv();
      
      const request: ChatCompletionRequest = {
        model: personality.model || getConfig().DEFAULT_AI_MODEL,
        messages,
        temperature: personality.temperature,
        max_tokens: personality.maxTokens,
        stream: true,
        user: context.userId
      };

      logger.info(`[AIService] Starting stream for ${personality.name}`);
      
      if (!provider.streamComplete) {
        throw new Error('Provider does not support streaming');
      }
      
      let buffer = '';
      for await (const chunk of provider.streamComplete(request)) {
        if (chunk.choices?.[0]?.delta?.content) {
          const content = chunk.choices[0].delta.content;
          buffer += content;
          yield content;
        }
      }

      // Check final response for errors
      if (this.isErrorResponse(buffer)) {
        throw new Error('AI returned error-like response in stream');
      }

      logger.info(`[AIService] Stream completed for ${personality.name}, ${buffer.length} chars`);

    } catch (error) {
      logger.error(`[AIService] Stream error for ${personality.name}:`, error);
      yield this.getErrorMessage(error, personality);
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const provider = AIProviderFactory.fromEnv();
      return await provider.healthCheck();
    } catch (error) {
      logger.error('[AIService] Health check failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const aiService = new AIService();