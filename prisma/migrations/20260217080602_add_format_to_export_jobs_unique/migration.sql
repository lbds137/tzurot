-- AlterTable: Include format in the unique constraint for export_jobs
-- This allows concurrent exports of the same shape in different formats (json + markdown)

-- Drop the old unique constraint (userId, sourceSlug, sourceService)
DROP INDEX "export_jobs_user_id_source_slug_source_service_key";

-- Create the new unique constraint including format
CREATE UNIQUE INDEX "export_jobs_user_id_source_slug_source_service_format_key" ON "export_jobs"("user_id", "source_slug", "source_service", "format");
