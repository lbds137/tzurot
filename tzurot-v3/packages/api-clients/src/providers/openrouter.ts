import { 
  AIProvider, 
  AIProviderConfig, 
  AIProviderError,
  ChatCompletionRequest, 
  ChatCompletionResponse,
  StreamChunk 
} from './types.js';

export interface OpenRouterConfig extends AIProviderConfig {
  siteUrl?: string;
  siteName?: string;
  // OpenRouter-specific options
  providers?: string[];
  route?: 'fallback' | 'weighted';
}

export class OpenRouterProvider implements AIProvider {
  public readonly name = 'OpenRouter';
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly defaultModel: string;

  constructor(config: OpenRouterConfig) {
    if (!config.apiKey) {
      throw new AIProviderError('API key is required', 'MISSING_API_KEY', undefined, this.name);
    }

    this.baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;
    this.defaultModel = config.defaultModel || 'anthropic/claude-3.5-sonnet';
    
    this.headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.siteUrl || 'https://github.com/your-org/tzurot',
      'X-Title': config.siteName || 'Tzurot Discord Bot',
      ...config.headers
    };
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    
    // Apply default model if not specified
    const finalRequest = {
      ...request,
      model: request.model || this.defaultModel,
      // OpenRouter-specific parameters can be added here
      stream: false // Ensure non-streaming for this method
    };

    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        const response = await fetch(url, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(finalRequest),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
          throw new AIProviderError(
            error.error?.message || `Request failed with status ${response.status}`,
            'API_ERROR',
            response.status,
            this.name
          );
        }
        
        const data = await response.json() as ChatCompletionResponse;
        return data;
        
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on client errors (4xx)
        if (error instanceof AIProviderError && error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }
        
        // Exponential backoff for retries
        if (attempt < this.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    
    throw lastError || new AIProviderError('Request failed after retries', 'MAX_RETRIES', undefined, this.name);
  }

  async *streamComplete(request: ChatCompletionRequest): AsyncIterable<StreamChunk> {
    const url = `${this.baseUrl}/chat/completions`;
    
    const finalRequest = {
      ...request,
      model: request.model || this.defaultModel,
      stream: true
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(finalRequest)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new AIProviderError(
        error.error?.message || `Stream request failed with status ${response.status}`,
        'STREAM_ERROR',
        response.status,
        this.name
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new AIProviderError('No response body', 'STREAM_ERROR', undefined, this.name);
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          
          try {
            const chunk = JSON.parse(data) as StreamChunk;
            yield chunk;
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  async listModels(): Promise<string[]> {
    const url = `${this.baseUrl}/models`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      throw new AIProviderError(
        `Failed to list models: ${response.statusText}`,
        'LIST_MODELS_ERROR',
        response.status,
        this.name
      );
    }

    const data = await response.json();
    return data.data.map((model: any) => model.id);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const models = await this.listModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }
}