/**
 * Suspect reasoning mis-channel detection (watch signal only).
 *
 * glm-4.5-air has been observed writing its entire in-character reply into
 * `reasoning_content` while emitting a throwaway fragment as visible content.
 * The length signature alone cannot distinguish that mis-channel from a
 * deliberately brief reply that follows long genuine meta-reasoning, so this
 * predicate must never drive automatic promotion or retry (a misfire would
 * leak real meta-reasoning to the user). Warn-level telemetry only; confirm
 * any hit by reading the request's llm_diagnostic_logs row.
 *
 * The check is scoped to the model family where the mis-channel was observed
 * and its noise rate was measured. Mandatory-reasoning models (GPT-OSS,
 * StepFun, DeepSeek R1, etc.) produce reasoning many times longer than a
 * short final reply as their NORMAL operating shape — running this signature
 * unscoped would flood the warn channel with by-design responses and dilute
 * the signal. Expanding the family list is a deliberate act that needs its
 * own noise-rate measurement.
 */

/** Model-name substrings whose responses are eligible for the mis-channel check */
const MISCHANNEL_MODEL_FAMILIES = ['glm'] as const;

const MISCHANNEL_MAX_CONTENT_LENGTH = 300;
const MISCHANNEL_MIN_REASONING_LENGTH = 500;
const MISCHANNEL_MIN_REASONING_TO_CONTENT_RATIO = 3;

/** Inputs for the mis-channel signature check */
export interface MischannelCheckInput {
  /** Model identifier for family scoping; undefined disables the check (unattributable) */
  modelName: string | undefined;
  /** Length of the cleaned visible content */
  contentLength: number;
  /** Length of the structured API reasoning */
  reasoningLength: number;
}

/**
 * Whether a response matches the suspect reasoning mis-channel signature:
 * an eligible-family model returned a short visible reply dwarfed by
 * structured reasoning (see the threshold docs above).
 */
export function isSuspectReasoningMischannel(input: MischannelCheckInput): boolean {
  if (input.modelName === undefined) {
    return false;
  }
  const model = input.modelName.toLowerCase();
  if (!MISCHANNEL_MODEL_FAMILIES.some(family => model.includes(family))) {
    return false;
  }
  return (
    input.contentLength < MISCHANNEL_MAX_CONTENT_LENGTH &&
    input.reasoningLength > MISCHANNEL_MIN_REASONING_LENGTH &&
    input.reasoningLength >= MISCHANNEL_MIN_REASONING_TO_CONTENT_RATIO * input.contentLength
  );
}
