# Manual Data Migrations

One-time data migrations that were applied directly via SQL rather than Prisma migrations.

## 2026-02-18: Normalize `customFields` keys on `personalities` table

**PR**: #663 (shapes import cleanup)
**Applied to**: dev and prod (2026-02-18)

Standardized shapes.inc personality `customFields` keys from script-import format to slash-command format:

| Old Key               | New Key          |
| --------------------- | ---------------- |
| `shapesIncId`         | `shapesId`       |
| `shapeInitialMessage` | `initialMessage` |
| `shapesIncAvatarUrl`  | _(removed)_      |
| `errorMessage`        | _(removed)_      |

Also added `importSource: 'shapes_inc'` and `shapesUsername: <slug>` to affected rows.

**Why manual**: This is a data normalization, not a schema change. Prisma migrations operate on schema (DDL), not data (DML). A seed script would be inappropriate since this should only run once.

**Impact if not applied**: Strategy 3 of `ShapesImportResolver` (`shapesId` JSON path lookup) won't match script-imported personalities. The resolver falls through to its error message suggesting a full import first. No data corruption — just a missed lookup path.

**SQL applied**:

```sql
UPDATE personalities
SET custom_fields = (
  custom_fields
  || CASE WHEN custom_fields ? 'shapesIncId'
     THEN jsonb_build_object('shapesId', custom_fields->'shapesIncId')
     ELSE '{}'::jsonb END
  || CASE WHEN custom_fields ? 'shapeInitialMessage'
     THEN jsonb_build_object('initialMessage', custom_fields->'shapeInitialMessage')
     ELSE '{}'::jsonb END
  || jsonb_build_object('importSource', 'shapes_inc', 'shapesUsername', slug)
  - 'shapesIncId' - 'shapeInitialMessage' - 'errorMessage' - 'shapesIncAvatarUrl'
)
WHERE custom_fields ? 'shapesIncId';
```
