/**
 * Types for the inspect command module
 */

import type { DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';

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

/** Result of a diagnostic log lookup */
export type LookupResult =
  { success: true; log: DiagnosticLog } | { success: false; errorMessage: string };

/** Metadata-only log entry for browse lists (from /recent endpoint) */
export interface DiagnosticLogSummary {
  id: string;
  requestId: string;
  personalityId: string | null;
  personalityName: string | null;
  userId: string | null;
  guildId: string | null;
  channelId: string | null;
  model: string;
  provider: string;
  durationMs: number;
  createdAt: string;
}

/** Available debug view types for interactive selection */
export enum DebugViewType {
  FullJson = 'full-json',
  CompactJson = 'compact-json',
  SystemPrompt = 'system-prompt',
  Reasoning = 'reasoning',
  MemoryInspector = 'memory-inspector',
  TokenBudget = 'token-budget',
  VoiceAttribution = 'voice-attribution',
  PipelineHealth = 'pipeline-health',
}
