/**
 * The full result-metadata → sendResponse passthrough (footer, modes, TTS).
 * One definition, spread at every success-path call site, so a new metadata
 * field can't silently reach one delivery path but not the others (error
 * paths forward a narrower, hand-picked subset). `thinkingContent` is
 * deliberately NOT forwarded: delivery has no renderer for it, and the
 * persistence paths read it from result.metadata directly.
 */

import { type QuotaFallbackCategoryValue } from '@tzurot/common-types/constants/error';
import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';

export interface ResultMetadataPassthrough {
  modelUsed?: string;
  routedModel?: string;
  providerUsed?: string;
  fallbackProviderAttempted?: string;
  quotaFallback?: {
    fromModel: string;
    category: QuotaFallbackCategoryValue;
  };
  isGuestMode?: boolean;
  freshModeEnabled?: boolean;
  incognitoModeActive?: boolean;
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
    routedModel: result.metadata?.routedModel,
    providerUsed: result.metadata?.providerUsed,
    fallbackProviderAttempted: result.metadata?.fallbackProviderAttempted,
    quotaFallback: result.metadata?.quotaFallback,
    isGuestMode: result.metadata?.isGuestMode,
    freshModeEnabled: result.metadata?.freshModeEnabled,
    incognitoModeActive: result.metadata?.incognitoModeActive,
    showModelFooter: result.metadata?.showModelFooter,
    ttsAudioKey: result.metadata?.ttsAudioKey,
    ttsAudioContentType: result.metadata?.ttsAudioContentType,
    ttsNotices: result.metadata?.ttsNotices,
  };
}
