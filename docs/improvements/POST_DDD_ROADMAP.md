# Post-DDD Implementation Roadmap

**Created**: June 18, 2025  
**Purpose**: Prioritized list of improvements to implement after DDD migration completes

## Overview

Once the DDD migration is complete and stable, we can leverage the clean architecture to implement previously frozen improvements. This roadmap prioritizes them based on value, complexity, and dependencies.

## Phase 1: Immediate Operational Improvements (Weeks 1-2)

### 1. Database Migration - Phase 1
**Priority**: CRITICAL  
**Reason**: Solves immediate pain of data loss during deployments  
**Quick Win**: Railway persistent volume for `/app/data`  
**Document**: `DATABASE_MIGRATION_PLAN.md`

- Day 1: Configure persistent volume
- Day 2-3: Test deployment persistence
- Week 2: Plan PostgreSQL migration using DDD repositories

### 2. Complete Timer Injection
**Priority**: HIGH  
**Reason**: 26 violations remain, affecting test performance  
**Effort**: 2-3 days  
**Benefits**: Faster tests, easier maintenance

### 3. Documentation Architecture Update
**Priority**: HIGH  
**Reason**: Current docs don't reflect DDD reality  
**Effort**: 2-3 days
- Update ARCHITECTURE.md with DDD layers
- Document dual system architecture
- Create onboarding guide for DDD

## Phase 2: Feature Enhancements (Weeks 3-4)

### 4. Profile Data Enhancement
**Priority**: MEDIUM  
**Reason**: Already have the data, just not using it  
**Document**: `PROFILE_DATA_ENHANCEMENT.md`  
**Quick Wins**:
- Status/presence in webhook
- Personality-specific error messages
- Initial greeting messages

### 5. Enhanced Multimodal Handling
**Priority**: MEDIUM  
**From**: `FEATURE_IDEAS.md`  
**Reason**: Users want to send multiple images
- Implement multi-attachment support
- One message per media item
- Maintain context across messages

## Phase 3: Infrastructure Upgrades (Weeks 5-6)

### 6. Database Migration - Phase 2
**Priority**: HIGH  
**Document**: `DATABASE_MIGRATION_PLAN.md`
- Implement PostgreSQL adapters
- Migrate auth tokens first (prevent re-auth)
- Then personalities (prevent reload delays)
- Keep file system as fallback

### 7. Express.js Migration (If Needed)
**Priority**: LOW  
**Document**: `EXPRESS_MIGRATION.md`  
**Trigger**: Only if adding complex HTTP features
- Current HTTP server is adequate
- Migrate only when adding auth/dashboard

## Phase 4: Architecture Evolution (Weeks 7-10)

### 8. TypeScript Migration
**Priority**: MEDIUM  
**Document**: `TYPESCRIPT_MIGRATION_PLAN.md`  
**Benefits**: Type safety for domain models
- Start with domain layer
- Gradual file-by-file migration
- Leverage DDD boundaries

### 9. Multi-User Scalability
**Priority**: MEDIUM  
**Document**: `MULTI_USER_SCALABILITY.md`
- Per-user state isolation
- Job queue implementation
- Resource pooling

## Phase 5: New Features (Weeks 11+)

### 10. Random Personality Trigger
**Priority**: LOW  
**From**: `FEATURE_IDEAS.md`
- Fun feature for established bot
- `!tz random [prompt]`

### 11. Personality Visibility Improvements
**Priority**: LOW  
**From**: `FEATURE_IDEAS.md`
- Better discovery mechanisms
- Public/private personalities
- Sharing features

## Implementation Guidelines

### Order Rationale

1. **Operational First**: Database prevents data loss
2. **Technical Debt**: Timer injection improves DX
3. **Quick Wins**: Profile enhancements use existing data
4. **Infrastructure**: Database unlocks scalability
5. **Evolution**: TypeScript when architecture stable
6. **New Features**: After foundation solid

### Success Criteria

Each phase should:
- Not break existing functionality
- Improve performance or UX
- Have comprehensive tests
- Update documentation

### Dependencies

```
Database Phase 1 → Database Phase 2
Timer Injection → (enables) → Faster development
Profile Enhancement → (requires) → Stable DDD
Database Phase 2 → (enables) → Multi-user scalability
Clean Architecture → (enables) → TypeScript migration
```

## Maintenance Items

### Ongoing
- Remove completed singleton exports (14 remain)
- Update architecture documentation
- Monitor performance metrics
- Clean up legacy code after Phase 4

### Technical Debt Payments
- Large file refactoring (webhookManager.js)
- Complete mock migration or abandon
- Standardize error handling

## Remember

> "The DDD migration gave us a foundation. Now we can build features without fear."

- Each improvement is now easier with clean architecture
- Don't rush - maintain quality
- Celebrate small wins
- Keep the feature freeze lessons in mind