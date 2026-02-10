/**
 * Types for the admin debug command module
 */

import type { DiagnosticPayload } from '@tzurot/common-types';

/** Database row for a diagnostic log */
export interface DiagnosticLog {
  id: string;
  requestId: string;
  triggerMessageId?: string;
  personalityId: string | null;
  userId: string | null;
  guildId: string | null;
  channelId: string | null;
  model: string;
  provider: string;
  durationMs: number;
  createdAt: string;
  data: DiagnosticPayload;
}

/** API response for a single diagnostic log */
export interface DiagnosticLogResponse {
  log: DiagnosticLog;
}

/** API response for multiple diagnostic logs */
export interface DiagnosticLogsResponse {
  logs: DiagnosticLog[];
  count: number;
}

/** Result of a diagnostic log lookup */
export type LookupResult =
  | { success: true; log: DiagnosticLog }
  | { success: false; errorMessage: string };

/** Available debug view types for interactive selection */
export enum DebugViewType {
  FullJson = 'full-json',
  CompactJson = 'compact-json',
  SystemPrompt = 'system-prompt',
  Reasoning = 'reasoning',
  MemoryInspector = 'memory-inspector',
  TokenBudget = 'token-budget',
}
