/**
 * The shared background-model call.
 *
 * Background work — fact extraction, roster-blurb summarization — runs on a
 * fixed cheap SYSTEM model rather than the personality's own, and every such
 * caller needs the same four things: resolve which provider to bill, build the
 * client, invoke with a JSON response format, and report the token counts a
 * `usage_logs` row needs. That sequence lived inside fact extraction until a
 * second caller appeared; it is here so a provider-routing fix lands once
 * rather than in each background job.
 *
 * What stays with the CALLER: its own timeout, its own OpenRouter attribution
 * suffix, its own retry/busy posture, and its own usage-row `requestType`.
 * Those differ per job by design — a 180s extraction batch and a one-card
 * summary should not share a deadline.
 */

import { HumanMessage } from '@langchain/core/messages';
import { getConfig } from '@tzurot/common-types/config/config';
import { AIProvider, toZaiWireModelId } from '@tzurot/common-types/constants/ai';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { createChatModel } from '../ModelFactory.js';
import { invokeModelGuarded } from '../../utils/invokeModelGuarded.js';

/** One background model call's outcome — content plus token usage for cost rows. */
export interface SystemModelResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  /** The provider the call ACTUALLY billed — carried into the usage row so an
   * injected invoker (eval harness, tests) can never mislabel provenance. */
  provider: AIProvider;
  /**
   * The model this call ACTUALLY used, resolved once at call start.
   *
   * Carried for the same reason as `provider`, and against a sharper hazard:
   * `extractionModel` is a `liveness: 'live'` setting an admin can change
   * mid-flight, and these calls run for up to 180s. A caller that re-read the
   * setting when writing its usage row would attribute the spend to whatever
   * the model is NOW, not what it billed. Read this instead of the setting.
   *
   * The value is the setting as written (`z-ai/glm-5.2`), not the bare id the
   * z.ai-direct route sends — that keeps the ledger's model column in one
   * format across providers, which is what it has always recorded.
   */
  model: string;
}

/** Model invocation seam — injectable for tests/eval (defaults to the real call). */
export type SystemModelInvoker = (prompt: string) => Promise<SystemModelResult>;

/**
 * Resolve the provider background work bills to. 'zai-coding' requires the
 * system coding-plan key — without it we fall back to OpenRouter (the
 * boot-time check in factExtractionSetup logs the misconfiguration loudly
 * once).
 */
export function resolveSystemModelRoute(): { provider: AIProvider; apiKey?: string } {
  if (
    getSystemSetting('extractionProvider') === 'zai-coding' &&
    getConfig().ZAI_CODING_API_KEY !== undefined
  ) {
    return { provider: AIProvider.ZaiCoding, apiKey: getConfig().ZAI_CODING_API_KEY };
  }
  return { provider: AIProvider.OpenRouter };
}

/** Per-call knobs that differ between background jobs. */
export interface SystemModelCallOptions {
  /** OpenRouter-only attribution header; inert on z.ai-direct (no analog —
   *  usage_logs requestType is the insight surface there). */
  appTitleSuffix: string;
  /** Hard deadline for the single model call. */
  timeoutMs: number;
}

/** The real model call — exported for eval harnesses (same code path as prod). */
export async function invokeSystemModel(
  prompt: string,
  options: SystemModelCallOptions
): Promise<SystemModelResult> {
  const systemModel = getSystemSetting('extractionModel');
  const route = resolveSystemModelRoute();
  // z.ai-direct takes the bare model id ('z-ai/glm-5.2' → 'glm-5.2'), same
  // mapping ProviderRouter applies to promoted completions. Detection is
  // case-insensitive (toZaiWireModelId), so a `Z-AI/glm-5` setting strips
  // correctly instead of reaching z.ai unstripped and 400ing.
  const modelName =
    route.provider === AIProvider.ZaiCoding ? toZaiWireModelId(systemModel) : systemModel;
  const { model } = createChatModel({
    modelName,
    temperature: 0,
    responseFormat: { type: 'json_object' },
    appTitleSuffix: options.appTitleSuffix,
    provider: route.provider,
    ...(route.apiKey !== undefined ? { apiKey: route.apiKey } : {}),
  });
  const response = await invokeModelGuarded(model, [new HumanMessage(prompt)], {
    timeout: options.timeoutMs,
  });
  return {
    content:
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content),
    tokensIn: response.usage_metadata?.input_tokens ?? 0,
    tokensOut: response.usage_metadata?.output_tokens ?? 0,
    provider: route.provider,
    model: systemModel,
  };
}
