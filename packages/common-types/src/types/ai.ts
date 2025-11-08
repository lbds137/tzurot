/**
 * AI-related types
 */

import { MessageRole } from '../config/constants.js';

export interface ChatCompletionRequest {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  user?: string;
}

export interface ConversationHistory {
  messages: {
    role: MessageRole;
    content: string;
    timestamp?: Date;
  }[];
}

export type MessageContent =
  | string
  | {
      content: string;
      referencedMessage?: {
        author?: string;
        content: string;
      };
      attachments?: {
        name?: string;
        url?: string;
        type?: string;
      }[];
    };
