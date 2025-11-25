/**
 * Prisma 7.0 Configuration
 *
 * This file provides the database URL for Prisma migrations.
 * The PrismaClient uses driver adapters configured in common-types/src/services/prisma.ts
 */

import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  earlyAccess: true,
  schema: 'prisma/schema.prisma',

  // Datasource configuration for migrations
  datasource: {
    url: env('DATABASE_URL'),
  },
});
