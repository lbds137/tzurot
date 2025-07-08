# Quick Start: Vertical Slice Migration

## TL;DR for Claude Code

The goal is to fix the architectural inconsistency by migrating the core message flow to DDD using vertical slices. Each slice completely migrates one user flow.

## What's the Problem?

- Commands use clean DDD architecture ✅
- Core message flow uses legacy patterns ❌
- This inconsistency makes the codebase confusing
- We have two architectures doing similar things differently

## The Solution: Vertical Slices

Instead of migrating horizontally (all of one type of component), migrate vertically (complete user flows).

## Start Here: Message Router

**First task: Create the router that will enable everything else**

1. Create `src/core/MessageRouter.js`
2. Make `messageHandler.js` delegate to it
3. Test that nothing breaks with router in place

## Then: First Vertical Slice

**Personality Mention Flow** (most common user interaction)

Current mess:
- Logic scattered across 4+ files
- Mixed concerns everywhere
- Hard to follow or debug

Target:
- One clean handler
- Clear flow from message to response
- Uses existing DDD components

## Implementation Order

1. **Week 1**: Message Router + Infrastructure
2. **Week 2**: Personality Mention Slice  
3. **Week 3**: Active Conversation Slice
4. **Week 4**: Command Flow Integration
5. **Week 5**: Reply/Reference Context
6. **Week 6**: Delete messageHandler.js! 🎉

## Key Files to Look At

### To Understand the Problem:
- `src/handlers/messageHandler.js` (706 lines) - This is what we're replacing
- `src/webhookManager.js` (642 lines) - Needs major cleanup
- `src/aiService.js` (457 lines) - Move to domain

### To See the Pattern:
- `src/application/commands/*` - This is what we want everywhere
- `src/domain/*` - Use these models
- `src/application/services/FeatureFlags.js` - For gradual rollout

## Success Looks Like

Before:
```
messageHandler.js: 706 lines of tangled logic
webhookManager.js: 642 lines doing everything
aiService.js: 457 lines with mixed concerns
```

After:
```
messageHandler.js: DELETED
MessageRouter.js: ~50 lines of clean routing
Slice handlers: ~100 lines each, single responsibility
Services: Small, focused, testable
```

## Remember

- Feature flags for each slice (like we did with commands)
- Test both paths before switching
- Delete legacy code once slice is stable
- This is about consistency, not perfection

## Questions to Answer Before Starting

1. Should we reuse the existing feature flag system? (Probably yes)
2. Should router be in `src/core/` or `src/application/`? 
3. Do we want to add correlation IDs while we're at it?

## Get Started

1. Read the full [VERTICAL_SLICE_IMPLEMENTATION_GUIDE.md](./VERTICAL_SLICE_IMPLEMENTATION_GUIDE.md)
2. Create MessageRouter
3. Pick first slice (recommend Personality Mention)
4. Implement, test, roll out
5. Repeat for each slice
6. Delete legacy code
7. Celebrate consistent architecture! 🎉