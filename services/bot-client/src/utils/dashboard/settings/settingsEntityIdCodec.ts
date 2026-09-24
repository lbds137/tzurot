/**
 * Settings customId entityId codec: shrinks a UUID entityId inside a settings
 * dashboard customId so the id fits Discord's 100-char component customId cap.
 *
 * A lowercase canonical UUID (36 chars) is rewritten as `~` plus its 16 bytes
 * in unpadded base64url (22 chars), 23 chars total. Every other entityId
 * passes through unchanged, in both directions, so ids rendered before the
 * compaction existed (raw UUID segments) still parse to the same entity.
 *
 * `~` is an unambiguous marker because no entityId producer can emit a value
 * starting with it:
 * - `characterDashboardShared.ts` `entityId: personality.id` (a Postgres UUID)
 * - `channel/settings.ts` `entityId: channelId` (a Discord snowflake, digits)
 * - `settings/defaults/edit.ts` `entityId: userId` (a Discord snowflake, digits)
 * - `admin/settings.ts` `entityId: 'global'`
 * `settingsEntityIdCodec.test.ts` pins that claim by round-tripping one id of
 * each producer's shape through the real customId build and parse.
 */

/** Lowercase canonical UUID only; an uppercase UUID is deliberately not compacted. */
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Marker prefix that identifies a compacted entityId segment. */
const COMPACT_MARKER = '~';

/** A marker followed by exactly 22 base64url characters (16 bytes, unpadded). */
const COMPACT_SEGMENT_PATTERN = /^~[A-Za-z0-9_-]{22}$/;

/** Byte length of a UUID. */
const UUID_BYTE_LENGTH = 16;

/**
 * Compact a lowercase canonical UUID to `~` + 22 base64url chars. Any other
 * value (`'global'`, a snowflake, an uppercase UUID) is returned unchanged.
 */
export function compactEntityId(entityId: string): string {
  if (!CANONICAL_UUID_PATTERN.test(entityId)) {
    return entityId;
  }
  const bytes = Buffer.from(entityId.replaceAll('-', ''), 'hex');
  return `${COMPACT_MARKER}${bytes.toString('base64url')}`;
}

/**
 * Expand a compacted segment back to the lowercase dashed UUID. Anything that
 * is not a canonical compacted segment is returned unchanged: a legacy raw
 * UUID, `'global'`, a snowflake, or a `~` segment whose encoding is not the
 * one `compactEntityId` would produce.
 *
 * The re-encode comparison is load-bearing: Node's base64url decoder ignores
 * the 4 padding bits in the last of the 22 chars, so a non-canonical segment
 * (e.g. `~` + 21 `A`s + `B`) decodes to the same bytes as a canonical one.
 */
export function expandEntityId(segment: string): string {
  if (!COMPACT_SEGMENT_PATTERN.test(segment)) {
    return segment;
  }
  const encoded = segment.slice(COMPACT_MARKER.length);
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.length !== UUID_BYTE_LENGTH || bytes.toString('base64url') !== encoded) {
    return segment;
  }
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
