/**
 * Save-time thinking-level validation warnings.
 *
 * A configured `thinking` level is a request, not a guarantee: some models
 * cannot turn reasoning off, some only try, and some don't reason at all. None
 * of those are save-blocking errors — capability data can be stale or briefly
 * unreachable, and a config must never become unsaveable because a catalog
 * lookup had a bad day. So this module produces advisory strings the routes
 * hand back alongside the saved config.
 *
 * Pure: no I/O, no clock, no cache. Callers resolve capabilities first and pass
 * the result in.
 */

import { zaiThinkingOffSupport } from '@tzurot/common-types/constants/ai';
import type { ThinkingLevel } from '@tzurot/common-types/schemas/llmAdvancedParams';
import type { ModelCapabilities } from '@tzurot/common-types/types/ai';

export interface CollectThinkingWarningsOptions {
  /**
   * The effective thinking level after the save — the patch's value on an
   * update that sets one, otherwise the stored row's. `undefined` means the
   * config carries no thinking key at all, which is distinct from `'off'`:
   * absent takes the provider default, so there is nothing to warn about.
   */
  thinking: ThinkingLevel | undefined;
  /** The effective model after the save. */
  model: string | undefined;
  /**
   * Resolved capabilities for `model`, or `null` when the model resolved
   * against neither source. A null here yields no warnings — an unresolvable
   * model is a capability gap, and guessing from the model's name is exactly
   * the pattern-matching this validation exists to avoid.
   */
  capabilities: ModelCapabilities | null;
}

/**
 * Collect advisory warnings about a thinking level the target model can't
 * honor. Returns an empty array when everything lines up, when there's nothing
 * to check, or when capability data can't answer the question.
 */
export function collectThinkingWarnings(options: CollectThinkingWarningsOptions): string[] {
  const { thinking, model, capabilities } = options;
  if (thinking === undefined || model === undefined) {
    return [];
  }

  const warnings: string[] = [];

  // Prefer the resolved capabilities, but fall back to the static z.ai catalog:
  // a GLM that OpenRouter also lists resolves as `source: 'openrouter'`, which
  // carries no thinking-off data, while that same model still routes z.ai-direct
  // for any user holding a z.ai coding key. Reading the catalog directly keeps
  // the warning attached to the model rather than to whichever source answered.
  const thinkingOff = capabilities?.thinkingOff ?? zaiThinkingOffSupport(model);

  if (thinking === 'off') {
    if (thinkingOff === 'unsupported') {
      warnings.push(
        `Model '${model}' cannot disable extended thinking, per z.ai's documentation. ` +
          `The 'off' level will be ignored and the model will keep reasoning.`
      );
    } else if (thinkingOff === 'best-effort') {
      warnings.push(
        `Disabling extended thinking is best-effort on GLM-5.x models. ` +
          `'${model}' accepts the 'off' level but may still produce reasoning.`
      );
    }
    // A non-off level cannot conflict with thinking-off semantics, and an 'off'
    // level on an 'honored' model is exactly what the user asked for.
    return warnings;
  }

  // Only an authoritative negative warrants this one: `undefined` means the
  // catalog couldn't answer, and treating that as "no reasoning support" would
  // warn on every model during a catalog outage. The z.ai-catalog guard is
  // belt-and-braces: every GLM the coding-plan catalog knows is a reasoning
  // model (its thinkingOff entry exists precisely because it reasons), so a
  // dual-listed GLM never gets this warning from another source's negative —
  // OpenRouter currently lists `reasoning` for every z-ai model (live-probed),
  // but that is their data to change, not ours to depend on.
  if (capabilities?.supportsReasoning === false && thinkingOff === undefined) {
    warnings.push(
      `Model '${model}' does not list reasoning support in the model catalog, ` +
        `so the '${thinking}' thinking level will have no effect.`
    );
  }

  return warnings;
}
