# Active Improvements

These are improvements currently being worked on as part of the DDD migration Phase 4.

## Feature Freeze Status

**FEATURE_FREEZE_NOTICE.md** - In effect until DDD migration completes (~August 2025)

## Technical Debt Being Addressed

**TECHNICAL_DEBT_INVENTORY.md** - Comprehensive list of debt being paid through DDD

### Remaining Work
- Timer injection (26 violations)
- Singleton removal (14 files) - see `/docs/ddd/SINGLETON_MIGRATION_GUIDE.md`
- Large file refactoring

## Work Tracking

**WORK_IN_PROGRESS.md** - Status of incomplete migrations

## Deployment Strategy

**BRANCH_STRATEGY.md** - How we're safely deploying the DDD system

## Next Steps

1. Enable feature flags in development
2. Test DDD commands thoroughly  
3. Complete timer injection
4. Remove remaining singletons
5. Enable in production gradually

See `/docs/ddd/DDD_ENABLEMENT_GUIDE.md` for detailed activation steps.