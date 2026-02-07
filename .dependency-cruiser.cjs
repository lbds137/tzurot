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
    // Baseline of known violations (54 circular deps as of 2026-02-07).
    // Run `pnpm depcruise:baseline` to regenerate after fixing violations.
    // DO NOT manually edit the baseline file.
    knownViolations: require('./.dependency-cruiser-baseline.json'),
    doNotFollow: {
      path: ['node_modules', 'dist', '\\.turbo'],
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
