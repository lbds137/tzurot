/**
 * Deny Browse Shared Types
 *
 * Leaf module for types shared across the deny command files.
 * Exists to break the circular import between `browse.ts` and
 * `detail.ts` / `detailEdit.ts` / `detailTypes.ts` that arises
 * because `browse.ts` lazily imports `detail.ts` to show the
 * detail view on select-menu clicks, while the detail files
 * previously re-imported the response shape from `browse.ts`.
 *
 * `DenylistEntryResponse` re-exports the schema-derived type to keep
 * the existing import surface stable. The schema lives in
 * `@tzurot/common-types/schemas/api/denylist.ts`.
 */

export type { DenylistEntry as DenylistEntryResponse } from '@tzurot/common-types/schemas/api/denylist';
