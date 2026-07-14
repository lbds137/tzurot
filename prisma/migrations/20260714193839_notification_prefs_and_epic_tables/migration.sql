-- CreateEnum
CREATE TYPE "notify_level" AS ENUM ('major', 'minor', 'patch');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('pending', 'sent', 'failed_transient', 'failed_permanent');

-- CreateEnum
CREATE TYPE "feedback_status" AS ENUM ('new', 'read', 'archived');

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notify_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_level" "notify_level" NOT NULL DEFAULT 'minor';

-- CreateTable
CREATE TABLE "release_announcements" (
    "id" UUID NOT NULL,
    "version" VARCHAR(50) NOT NULL,
    "level" "notify_level" NOT NULL,
    "github_release_id" VARCHAR(30) NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "release_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_delivery_log" (
    "id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'pending',
    "error_code" VARCHAR(50),
    "attempted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_delivery_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_feedback" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "status" "feedback_status" NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "release_announcements_version_key" ON "release_announcements"("version");

-- CreateIndex
CREATE UNIQUE INDEX "release_delivery_log_release_id_user_id_key" ON "release_delivery_log"("release_id", "user_id");

-- AddForeignKey
ALTER TABLE "release_delivery_log" ADD CONSTRAINT "release_delivery_log_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "release_announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_delivery_log" ADD CONSTRAINT "release_delivery_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_feedback" ADD CONSTRAINT "user_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
