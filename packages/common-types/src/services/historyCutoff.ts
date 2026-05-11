/**
 * History fetch time-cutoff helper.
 *
 * Conversation-history fetches accept two independent lower-bound filters:
 *   - `maxAgeSeconds`: a relative window like "messages from the last hour"
 *     (the user-facing cascade setting; mirrors `DiscordChannelFetcher`)
 *   - `contextEpoch`: an explicit reset point (e.g., from `/conversation reset`)
 *
 * Both are lower bounds — older messages are excluded — so combining them
 * means taking the more recent (later) cutoff. This is the single source of
 * truth used by both `getChannelHistory` and `getCrossChannelHistory` so the
 * two paths can't drift in their interpretation of "after which timestamp".
 */

/**
 * Combine an optional max-age window and an optional explicit context epoch
 * into a single `createdAt >=` cutoff Date.
 *
 * Returns undefined when neither input is set, signalling the caller to omit
 * the time filter entirely from the underlying query.
 */
export function computeHistoryCutoff(
  maxAgeSeconds: number | null | undefined,
  contextEpoch: Date | undefined
): Date | undefined {
  const cutoffs: Date[] = [];
  if (maxAgeSeconds !== undefined && maxAgeSeconds !== null) {
    cutoffs.push(new Date(Date.now() - maxAgeSeconds * 1000));
  }
  if (contextEpoch !== undefined) {
    cutoffs.push(contextEpoch);
  }
  if (cutoffs.length === 0) {
    return undefined;
  }
  return cutoffs.reduce((latest, c) => (c > latest ? c : latest));
}
