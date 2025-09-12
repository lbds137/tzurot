import { AIProvider, AIProviderConfig } from './types.js';
import { OpenRouterProvider, OpenRouterConfig } from './openrouter.js';
// Future providers can be imported here
// import { OpenAIProvider } from './openai.js';
// import { AnthropicProvider } from './anthropic.js';
// import { LocalLlamaProvider } from './local-llama.js';

export type ProviderType = 'openrouter' | 'openai' | 'anthropic' | 'local';

export interface ProviderFactoryConfig {
  type: ProviderType;
  config: AIProviderConfig;
}

/**
 * Factory for creating AI provider instances
 * Makes it easy to switch between providers without changing application code
 */
export class AIProviderFactory {
  private static providers = new Map<string, AIProvider>();

  /**
   * Create a new AI provider instance
   */
  static create(type: ProviderType, config: AIProviderConfig): AIProvider {
    switch (type) {
      case 'openrouter':
        return new OpenRouterProvider(config as OpenRouterConfig);
      
      case 'openai':
        // When you want to add direct OpenAI support:
        // return new OpenAIProvider(config);
        throw new Error('OpenAI provider not yet implemented. Use OpenRouter for OpenAI models.');
      
      case 'anthropic':
        // When you want to add direct Anthropic support:
        // return new AnthropicProvider(config);
        throw new Error('Anthropic provider not yet implemented. Use OpenRouter for Claude models.');
      
      case 'local':
        // For local models like Ollama:
        // return new LocalLlamaProvider(config);
        throw new Error('Local provider not yet implemented.');
      
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }

  /**
   * Register a singleton provider instance
   */
  static register(name: string, type: ProviderType, config: AIProviderConfig): AIProvider {
    const provider = this.create(type, config);
    this.providers.set(name, provider);
    return provider;
  }

  /**
   * Get a registered provider by name
   */
  static get(name: string): AIProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get or create a provider
   */
  static getOrCreate(name: string, type: ProviderType, config: AIProviderConfig): AIProvider {
    let provider = this.providers.get(name);
    if (!provider) {
      provider = this.register(name, type, config);
    }
    return provider;
  }

  /**
   * Clear all registered providers
   */
  static clear(): void {
    this.providers.clear();
  }

  /**
   * Create a provider from environment variables
   * Uses validated configuration to ensure all required vars are present
   */
  static fromEnv(): AIProvider {
    // Import dynamically to avoid circular dependencies
    const { getConfig } = require('@tzurot/common-types/dist/config');
    const config = getConfig();
    
    switch (config.AI_PROVIDER) {
      case 'openrouter':
        return this.create('openrouter', {
          apiKey: config.OPENROUTER_API_KEY,
          baseUrl: config.OPENROUTER_BASE_URL,
          defaultModel: config.DEFAULT_AI_MODEL,
        });
      
      case 'openai':
        throw new Error('OpenAI provider not yet implemented. Use OpenRouter for OpenAI models.');
      
      case 'anthropic':
        throw new Error('Anthropic provider not yet implemented. Use OpenRouter for Claude models.');
      
      case 'local':
        throw new Error('Local provider not yet implemented.');
      
      default:
        throw new Error(`Provider ${config.AI_PROVIDER} not configured`);
    }
  }
}