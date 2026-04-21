/**
 * Deny Browse Shared Types
 *
 * Leaf module for types shared across the deny command files.
 * Exists to break the circular import between `browse.ts` and
 * `detail.ts` / `detailEdit.ts` / `detailTypes.ts` that arises
 * because `browse.ts` lazily imports `detail.ts` to show the
 * detail view on select-menu clicks, while the detail files
 * previously re-imported the response shape from `browse.ts`.
 */

/** Response shape from GET /admin/denylist */
export interface DenylistEntryResponse {
  id: string;
  type: string;
  discordId: string;
  scope: string;
  scopeId: string;
  mode: string;
  reason: string | null;
  addedAt: string;
  addedBy: string;
}
