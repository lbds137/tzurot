/**
 * Discord application IDs of message-proxy systems (PluralKit, TupperBox, …) that
 * re-post HUMAN messages via webhooks. A referenced message whose owning
 * `applicationId` is in this list is a proxied human → `role="user"`, not a
 * non-persona bot → `role="bot"`.
 *
 * An `applicationId` NOT in this list (and not our own bot's) falls into the `bot`
 * catch-all — correct by construction: not clearly our persona, not clearly an
 * unproxied human. Each entry documents how its id was established; the bar for
 * adding one is "this app proxies humans and we trust the id" — Discord doesn't
 * reliably populate `application_id` on plain webhook executes, so a real sighting
 * (or a strong public-knowledge basis) is what justifies an entry.
 */
export const KNOWN_PROXY_APP_IDS: readonly string[] = [
  '466378653216014359', // PluralKit — confirmed present on a real proxied reference in our logs
  '431544605209788416', // TupperBox — operator-confirmed public app id; same app-owned-webhook proxy behavior as PluralKit
];
