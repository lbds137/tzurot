# Post-DDD Improvements

These improvements are frozen until the DDD migration completes. They are prioritized and ready to implement once we have a solid foundation.

## Start Here

**POST_DDD_ROADMAP.md** - Prioritized implementation plan with dependencies

## High Priority (Weeks 1-2)

### DATABASE_MIGRATION_PLAN.md
- Solves deployment data loss pain
- Quick win: Railway persistent volume
- Long term: PostgreSQL migration

## Medium Priority (Weeks 3-6)

### PROFILE_DATA_ENHANCEMENT.md  
- Use existing API data we're not leveraging
- Quick wins with personality-specific messages

### FEATURE_IDEAS.md
- Random personality trigger
- Multi-attachment support
- Personality visibility improvements

### MULTI_USER_SCALABILITY.md
- Per-user state isolation
- Resource pooling
- Job queue implementation

## Lower Priority (Weeks 7+)

### TYPESCRIPT_MIGRATION_PLAN.md
- Type safety for domain models
- Gradual migration approach

### EXPRESS_MIGRATION.md
- Only if HTTP needs grow
- Current server is adequate

### LRUCACHE_MIGRATION_PLAN.md
- Performance optimization
- Better cache management

## Why These Are Frozen

The DDD migration gives us:
- Clean boundaries for easier implementation
- Repository pattern for database migration
- Event system for scalability features
- Modular architecture for TypeScript

Each improvement will be significantly easier to implement with the DDD foundation in place.