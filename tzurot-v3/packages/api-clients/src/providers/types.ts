/**
 * Vendor-agnostic AI provider types
 * Designed to be compatible with OpenAI API structure but extensible for other providers
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  stream?: boolean;
  user?: string;
  // Provider-specific extensions can be added here
  [key: string]: any;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'function_call' | 'content_filter' | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }>;
}

export interface AIProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  timeout?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
}

export interface AIProvider {
  name: string;
  
  /**
   * Send a chat completion request
   */
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  
  /**
   * Stream a chat completion response
   */
  streamComplete?(request: ChatCompletionRequest): AsyncIterable<StreamChunk>;
  
  /**
   * List available models (optional)
   */
  listModels?(): Promise<string[]>;
  
  /**
   * Check if the provider is properly configured and reachable
   */
  healthCheck(): Promise<boolean>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public provider?: string
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}