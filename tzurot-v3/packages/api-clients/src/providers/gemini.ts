import { AIProvider, AIProviderConfig, ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from './types.js';
import { pino } from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

export interface GeminiConfig extends AIProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

interface GeminiContent {
  role: string;
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * Google Gemini AI Provider
 * Implements the AIProvider interface for Gemini API
 */
export class GeminiProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.defaultModel = config.defaultModel ?? 'gemini-1.5-flash';
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = request.model ?? this.defaultModel;
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

    // Convert OpenAI-style messages to Gemini format
    const geminiRequest = this.convertRequest(request);

    logger.debug(`[GeminiProvider] Requesting completion with model ${model}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${error}`);
    }

    const data = await response.json() as GeminiResponse;

    // Convert Gemini response to OpenAI format
    return this.convertResponse(data);
  }

  async *streamComplete(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionResponse, void, unknown> {
    const model = request.model ?? this.defaultModel;
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

    const geminiRequest = this.convertRequest(request);

    logger.debug(`[GeminiProvider] Starting stream with model ${model}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${error}`);
    }

    if (response.body === null) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') continue;

            try {
              const data = JSON.parse(jsonStr) as GeminiResponse;
              yield this.convertResponse(data, true);
            } catch (e) {
              logger.warn(`[GeminiProvider] Failed to parse SSE line: ${line}`);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Simple health check with minimal tokens
      const response = await this.complete({
        model: this.defaultModel,
        messages: [
          { role: 'user', content: 'ping' }
        ],
        max_tokens: 5
      });

      return response.choices.length > 0;
    } catch (error) {
      logger.error('[GeminiProvider] Health check failed:', error);
      return false;
    }
  }

  /**
   * Convert OpenAI-style request to Gemini format
   */
  private convertRequest(request: ChatCompletionRequest): GeminiRequest {
    const contents: GeminiContent[] = [];
    let systemInstruction = '';

    // Gemini handles system messages differently - combine them into a system instruction
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemInstruction += msg.content + '\n';
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }
    }

    // If we have a system instruction, prepend it to the first user message
    if (systemInstruction.length > 0 && contents.length > 0) {
      const firstUserMsg = contents.find(c => c.role === 'user');
      if (firstUserMsg !== undefined) {
        firstUserMsg.parts[0].text = `${systemInstruction}\n${firstUserMsg.parts[0].text}`;
      }
    }

    return {
      contents,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.max_tokens
      }
    };
  }

  /**
   * Convert Gemini response to OpenAI format
   */
  private convertResponse(data: GeminiResponse, isStreaming = false): ChatCompletionResponse {
    const candidate = data.candidates[0];

    if (candidate === undefined) {
      throw new Error('No candidates in Gemini response');
    }

    const text = candidate.content.parts[0]?.text ?? '';

    return {
      id: `gemini-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: this.defaultModel,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text
          },
          delta: isStreaming ? { content: text } : undefined,
          finish_reason: candidate.finishReason?.toLowerCase() ?? 'stop'
        }
      ],
      usage: data.usageMetadata !== undefined ? {
        prompt_tokens: data.usageMetadata.promptTokenCount,
        completion_tokens: data.usageMetadata.candidatesTokenCount,
        total_tokens: data.usageMetadata.totalTokenCount
      } : undefined
    };
  }
}
