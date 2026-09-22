/**
 * The full result-metadata → sendResponse passthrough (footer, modes, TTS).
 * One definition, spread at every success-path call site, so a new metadata
 * field can't silently reach one delivery path but not the others. Error
 * paths forward a narrower subset via their own builder
 * (`buildErrorResultMetadataPassthrough`, below), which DERIVES that subset
 * from this builder's own output by omitting `routedModel` and the three TTS
 * fields (`ttsAudioKey`, `ttsAudioContentType`, `ttsNotices`). Deriving by
 * omission means a new field added to the success builder reaches the error
 * delivery paths by default, and the omission list is the only thing to keep
 * up to date. Those four omissions are inherited from what the error delivery
 * sites already forwarded before this builder existed, not re-decided here.
 * `thinkingContent` is deliberately NOT forwarded by either
 * builder: delivery has no renderer for it, and the persistence paths read it
 * from result.metadata directly.
 */

import { type QuotaFallbackCategoryValue } from '@tzurot/common-types/constants/error';
import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';

export interface ResultMetadataPassthrough {
  modelUsed?: string;
  routedModel?: string;
  providerUsed?: string;
  fallbackProviderAttempted?: string;
  fallbackFromProvider?: string;
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
    fallbackFromProvider: result.metadata?.fallbackFromProvider,
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

export type ErrorResultMetadataPassthrough = Omit<
  ResultMetadataPassthrough,
  'routedModel' | 'ttsAudioKey' | 'ttsAudioContentType' | 'ttsNotices'
>;

export function buildErrorResultMetadataPassthrough(
  result: LLMGenerationResult
): ErrorResultMetadataPassthrough {
  const {
    routedModel: _routedModel,
    ttsAudioKey: _ttsAudioKey,
    ttsAudioContentType: _ttsAudioContentType,
    ttsNotices: _ttsNotices,
    ...rest
  } = buildResultMetadataPassthrough(result);
  return rest;
}
