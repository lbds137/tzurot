-- AlterTable
ALTER TABLE "users" ADD COLUMN     "nsfw_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nsfw_verified_at" TIMESTAMP(3);
