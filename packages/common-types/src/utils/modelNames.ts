/**
 * Model-name display helpers.
 *
 * Provider-qualified model ids (`z-ai/glm-5.2`, `openrouter/auto`) carry the
 * provider as a path prefix. Display surfaces show only the short name, and
 * usage aggregation groups by it (the same model reached via two providers is
 * one model to the user — the per-provider split has its own section).
 */

/**
 * The short display name of a model id: the segment after the last `/`.
 * Ids without a prefix pass through unchanged. Idempotent.
 */
export function shortModelName(model: string): string {
  if (!model.includes('/')) {
    return model;
  }
  const short = model.split('/').pop();
  return short !== undefined && short.length > 0 ? short : model;
}
