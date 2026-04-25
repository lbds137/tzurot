/**
 * OpenRouter reasoning extraction.
 *
 * OpenRouter normalizes reasoning to `message.reasoning` per OpenAI's GPT-OSS
 * canonical guidance (also adopted by vLLM via RFC #27755). LangChain's
 * @langchain/openai chat completions converter (dist/converters/completions.js:160)
 * looks for `message.reasoning_content` (DeepSeek's legacy field) and silently
 * drops `message.reasoning`. Tracked in langchain-ai/langchain#32981 and #34706.
 *
 * Workaround: enable `__includeRawResponse: true` on ChatOpenAI (typed in
 * @langchain/openai dist/types.d.ts:121, marked experimental beta). This stuffs
 * the full raw OpenRouter response into `additional_kwargs.__raw_response`.
 * We then populate the fields LangChain would have populated natively if it
 * recognized OpenRouter's field name — `additional_kwargs.reasoning` and
 * `response_metadata.reasoning_details` — so downstream
 * ResponsePostProcessor.extractApiReasoning() picks them up via its existing
 * primary/fallback path (see ResponsePostProcessor.ts:120-138).
 *
 * Also captures `__raw_response.provider` (the actual upstream provider —
 * Parasail, Chutes, etc.) into `response_metadata.openrouter.provider` for
 * diagnostic segmentation. LangChain's converter hardcodes
 * `response_metadata.model_provider = "openai"` regardless of upstream provider,
 * which is useless for incident investigation.
 *
 * Memory hygiene: deletes __raw_response after extraction (200-500KB raw
 * payloads must not flow into BullMQ job results).
 *
 * IMPORTANT: this function expects a complete AIMessage from `model.invoke()`.
 * It is NOT safe to call on streaming chunks — partial chunks lack
 * `finish_reason` and `__raw_response` and will be returned unchanged via the
 * stream-safety guard.
 */

import { type BaseMessage } from '@langchain/core/messages';
import { createLogger } from '@tzurot/common-types';
import { extractApiReasoningContent } from '../../utils/thinkingExtraction.js';

const logger = createLogger('ModelFactory');

/**
 * Diagnostic metadata captured from OpenRouter's raw response, exposed under
 * `response_metadata.openrouter` for downstream diagnostic recorders to read.
 */
export interface OpenRouterMessageMetadata {
  /** Upstream provider name (e.g. "Parasail", "Chutes") — NOT LangChain's hardcoded "openai" */
  provider?: string;
  /** Keys present on raw response `choices[0].message`. Distinguishes "model returned structured reasoning" from "model embedded planning into content" */
  apiMessageKeys: string[];
  /** Length of `message.reasoning` from raw API response. Zero = model did not emit structured reasoning */
  apiReasoningLength: number;
}

/**
 * Validate and extract the raw message object from __raw_response. Returns null
 * for any of: stream chunk pass-through, regression-detected (logs warn),
 * malformed (logs warn + cleans up). On non-null return, caller proceeds with
 * extraction.
 */
function validateAndExtractRawMessage(
  kwargs: Record<string, unknown>,
  metadata: Record<string, unknown>
): { raw: Record<string, unknown>; rawMessage: Record<string, unknown> } | null {
  const rawResponse = kwargs.__raw_response;

  if (rawResponse === undefined) {
    // Streaming chunk (no finish_reason): pass through silently.
    if (metadata.finish_reason === undefined && metadata.finishReason === undefined) {
      return null;
    }
    // Completed message but no raw response: __includeRawResponse may not be set,
    // or LangChain may have changed the field name. Log loudly.
    logger.warn(
      {
        additionalKwargsKeys: Object.keys(kwargs),
        responseMetadataKeys: Object.keys(metadata),
      },
      '[OpenRouterReasoning] Expected __raw_response in additional_kwargs but found none — verify ChatOpenAI __includeRawResponse setting and @langchain/openai version'
    );
    return null;
  }

  if (typeof rawResponse !== 'object' || rawResponse === null) {
    logger.warn(
      { rawResponseType: typeof rawResponse },
      '[OpenRouterReasoning] __raw_response is not an object — skipping extraction'
    );
    delete kwargs.__raw_response;
    return null;
  }

  const raw = rawResponse as Record<string, unknown>;
  const choices = raw.choices;
  const firstChoice = Array.isArray(choices)
    ? (choices[0] as Record<string, unknown> | undefined)
    : undefined;
  const rawMessage = firstChoice?.message as Record<string, unknown> | undefined;

  if (rawMessage === undefined) {
    delete kwargs.__raw_response;
    return null;
  }

  return { raw, rawMessage };
}

/**
 * Build the `response_metadata.openrouter.*` diagnostic object.
 */
function buildOpenrouterMetadata(
  raw: Record<string, unknown>,
  rawMessage: Record<string, unknown>
): OpenRouterMessageMetadata {
  const result: OpenRouterMessageMetadata = {
    apiMessageKeys: Object.keys(rawMessage),
    apiReasoningLength: typeof rawMessage.reasoning === 'string' ? rawMessage.reasoning.length : 0,
  };
  if (typeof raw.provider === 'string') {
    result.provider = raw.provider;
  }
  return result;
}

/**
 * Populate the reasoning paths on the message based on the raw API response.
 *
 * Edge case: when `content` is empty but reasoning is populated (some free-tier
 * GLM variants emit the actual response in `reasoning`), promote reasoning to
 * visible content. Otherwise, populate the standard kwargs/metadata fields that
 * ResponsePostProcessor reads.
 */
function populateReasoningFields(
  message: BaseMessage,
  kwargs: Record<string, unknown>,
  metadata: Record<string, unknown>,
  rawMessage: Record<string, unknown>
): void {
  const rawReasoningString =
    typeof rawMessage.reasoning === 'string' && rawMessage.reasoning.length > 0
      ? rawMessage.reasoning
      : null;
  const rawReasoningDetails =
    Array.isArray(rawMessage.reasoning_details) && rawMessage.reasoning_details.length > 0
      ? (rawMessage.reasoning_details as unknown[])
      : null;

  if (rawReasoningString === null && rawReasoningDetails === null) {
    return;
  }

  const messageContent = typeof message.content === 'string' ? message.content : '';
  const isEmptyContent = messageContent.trim().length === 0;

  if (isEmptyContent) {
    // Promote reasoning to visible content. Skip kwargs/metadata population to
    // avoid duplicating the actual response into the audit trail as "thinking".
    const reasoningFromDetails =
      rawReasoningDetails !== null ? extractApiReasoningContent(rawReasoningDetails) : null;
    // Prefer the string source over the details extraction. On OpenRouter
    // responses, both fields typically carry equivalent content when both are
    // present; the string is the simpler representation and skips the details
    // walk. The fallback to details-extraction handles providers that emit
    // reasoning_details without the convenience string field.
    const effectiveReasoning = rawReasoningString ?? reasoningFromDetails;
    if (effectiveReasoning !== null && effectiveReasoning.length > 0) {
      message.content = effectiveReasoning;
    }
    return;
  }

  // Normal case. Populate the fields LangChain WOULD have populated natively
  // if its converter recognized OpenRouter's `reasoning` field name.
  if (rawReasoningString !== null) {
    kwargs.reasoning = rawReasoningString;
  }
  if (rawReasoningDetails !== null) {
    metadata.reasoning_details = rawReasoningDetails;
  }
}

/**
 * Extract OpenRouter reasoning fields from `additional_kwargs.__raw_response`
 * and populate the standard reasoning paths LangChain expects downstream.
 *
 * Mutates `message.additional_kwargs` and `message.response_metadata` in place.
 * Returns the same message reference for fluent style.
 *
 * Behavior:
 * - Stream-safety: when `__raw_response` AND `finish_reason` are both absent,
 *   returns unchanged (likely a partial streaming chunk).
 * - Loud regression detection: when `finish_reason` is present but
 *   `__raw_response` is absent, logs a warning. This catches the case where a
 *   future LangChain version bump removes/renames `__includeRawResponse`.
 * - Defensive on malformed `__raw_response`: logs warn, cleans up the field,
 *   returns unchanged.
 */
export function extractAndPopulateOpenRouterReasoning(message: BaseMessage): BaseMessage {
  // Defensive guards: real LangChain BaseMessages always have `{}` for both fields,
  // but test mocks routinely omit them and we should not crash retry/error paths.
  if (message === null || message === undefined) {
    return message;
  }
  const kwargs = message.additional_kwargs as Record<string, unknown> | undefined;
  const metadata = message.response_metadata as Record<string, unknown> | undefined;
  if (kwargs === undefined || metadata === undefined) {
    return message;
  }

  const validated = validateAndExtractRawMessage(kwargs, metadata);
  if (validated === null) {
    return message;
  }
  const { raw, rawMessage } = validated;

  metadata.openrouter = buildOpenrouterMetadata(raw, rawMessage);
  populateReasoningFields(message, kwargs, metadata, rawMessage);

  // Memory hygiene: a long-reasoning request's raw response can be 200-500KB.
  // Deleting prevents bloat into BullMQ job results / Redis storage.
  delete kwargs.__raw_response;

  return message;
}
