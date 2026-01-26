-- Add functional index for case-insensitive username lookups
-- Used by UserReferenceResolver.resolveByUsername() which uses mode: 'insensitive'
-- A regular B-tree index won't help case-insensitive queries; we need lower()
CREATE INDEX IF NOT EXISTS "users_username_lower_idx" ON "users" (lower("username"));
