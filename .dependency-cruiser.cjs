/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // === HARD BOUNDARIES (errors) ===
    {
      name: 'bot-client-no-prisma',
      comment: 'bot-client must NEVER import Prisma directly — use gateway APIs',
      severity: 'error',
      from: { path: '^services/bot-client/' },
      to: { path: '@prisma/client' },
    },
    {
      name: 'no-cross-service-imports',
      comment: 'Services must not import from each other — use common-types or APIs',
      severity: 'error',
      from: { path: '^services/([^/]+)/' },
      to: {
        path: '^services/([^/]+)/',
        pathNot: '^services/$1/',
      },
    },
    {
      name: 'no-circular-dependencies',
      comment: 'Circular dependencies break reasoning and import ordering',
      severity: 'error',
      from: {},
      to: { circular: true },
    },

    // === WARNINGS ===
    {
      name: 'ai-worker-no-discord',
      comment: 'ai-worker should use common-types for Discord types, not discord.js',
      severity: 'warn',
      from: { path: '^services/ai-worker/' },
      to: { path: 'discord\\.js' },
    },
  ],
  options: {
    doNotFollow: {
      path: ['node_modules', 'dist', '\\.turbo'],
    },
    exclude: {
      // Generated Prisma client has inherent circular deps (models ↔ prismaNamespace).
      // These are auto-generated and unfixable — exclude rather than baseline.
      path: ['src/generated/prisma/'],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: './tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    cache: {
      strategy: 'content',
      folder: 'node_modules/.cache/dependency-cruiser',
    },
    includeOnly: ['^services/', '^packages/'],
  },
};
