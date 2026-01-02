-- DropIndex

-- CreateTable
CREATE TABLE "image_description_cache" (
    "id" UUID NOT NULL,
    "attachment_id" VARCHAR(20) NOT NULL,
    "description" TEXT NOT NULL,
    "model" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "image_description_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "image_description_cache_attachment_id_key" ON "image_description_cache"("attachment_id");

-- CreateIndex
CREATE INDEX "image_description_cache_attachment_id_idx" ON "image_description_cache"("attachment_id");

-- CreateIndex
