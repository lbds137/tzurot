/**
 * Worker-side context-assembly feature flags.
 *
 * Home for the env-flag readers that gate the context-relocation cutover. The
 * promote flag previously lived in `shadowHydration.ts`, but a promotion switch
 * in a shadow-instrumentation file misleads — that file is deleted when shadow
 * instrumentation is retired, while the cutover machinery stays. Keep cutover
 * flags here.
 */

/**
 * When true (CONTEXT_ASSEMBLY_PROMOTE=true), ContextStep builds the prompt
 * context from the worker-side ContextAssembler (envelope-derived) instead of
 * the bot's legacy payload fields, for TRANSITIONAL jobs (envelope present but
 * `kind` not yet 'envelope'). Additionally gated on envelope presence + an
 * assembler being wired (see ContextStep), so an envelope-less job falls back
 * to legacy. Reversible: flip the flag + restart.
 *
 * NOTE: a `kind: 'envelope'` job assembles unconditionally — the producer
 * dropped the legacy fields, so there is nothing to fall back to. This flag
 * governs only the transitional fat-envelope path; once the bot is fully thin
 * it becomes a no-op (retired in a later cleanup).
 */
export function isAssemblyPromoteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONTEXT_ASSEMBLY_PROMOTE === 'true';
}
