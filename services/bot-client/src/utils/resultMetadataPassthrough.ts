/**
 * The full result-metadata → sendResponse passthrough (footer, modes,
 * thinking, TTS). One definition, spread at every success-path call site, so
 * a new metadata field can't silently reach one delivery path but not the
 * others (error paths forward a narrower, hand-picked subset).
 */

import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';

export interface ResultMetadataPassthrough {
  modelUsed?: string;
  providerUsed?: string;
  fallbackProviderAttempted?: string;
  quotaFallback?: { fromModel: string; category: 'quota_exceeded' | 'credit_exhaustion' };
  isGuestMode?: boolean;
  focusModeEnabled?: boolean;
  incognitoModeActive?: boolean;
  thinkingContent?: string;
  showThinking?: boolean;
  showModelFooter?: boolean;
  ttsAudioKey?: string;
  ttsAudioContentType?: string;
  ttsNotices?: string[];
}

export function buildResultMetadataPassthrough(
  result: LLMGenerationResult
): ResultMetadataPassthrough {
  return {
    modelUsed: result.metadata?.modelUsed,
    providerUsed: result.metadata?.providerUsed,
    fallbackProviderAttempted: result.metadata?.fallbackProviderAttempted,
    quotaFallback: result.metadata?.quotaFallback,
    isGuestMode: result.metadata?.isGuestMode,
    focusModeEnabled: result.metadata?.focusModeEnabled,
    incognitoModeActive: result.metadata?.incognitoModeActive,
    thinkingContent: result.metadata?.thinkingContent,
    showThinking: result.metadata?.showThinking,
    showModelFooter: result.metadata?.showModelFooter,
    ttsAudioKey: result.metadata?.ttsAudioKey,
    ttsAudioContentType: result.metadata?.ttsAudioContentType,
    ttsNotices: result.metadata?.ttsNotices,
  };
}
