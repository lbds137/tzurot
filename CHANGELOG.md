# Changelog

> **This file is not actively maintained.**
>
> For accurate and up-to-date release notes, please see [GitHub Releases](https://github.com/lbds137/tzurot/releases).

This CHANGELOG.md exists for convention but may be incomplete or outdated. The source of truth for version history is GitHub Releases.

## [Unreleased] - Horizontal Scaling Support

### Added
- **Pipeline Pattern for LLM Generation**: Refactored `LLMGenerationHandler` from 617→131 lines using stateless pipeline steps (Validation → Dependencies → Config → Auth → Context → Generation). Thread-safe for concurrent BullMQ job processing.
- **Redis-backed Rate Limiter**: `RedisRateLimiter` with Lua script for atomic INCR+EXPIRE. Enables horizontal scaling of api-gateway instances.
- **Redis-backed Request Deduplication**: `RedisDeduplicationCache` using SHA-256 hashing and SCAN (not KEYS) for non-blocking cache size checks.
- **API Gateway Modularization**: Split `index.ts` (532→259 lines) into `bootstrap/`, `middleware/`, and `routes/public/` modules.
- **17 new test files** with comprehensive coverage for all new components.

### Changed
- `api-gateway/index.ts` reduced by 51% (532→259 lines)
- `LLMGenerationHandler.ts` reduced by 79% (617→131 lines)
- Net reduction of 1,762 lines through better abstraction

### Fixed
- Race condition in rate limiter (INCR and EXPIRE now atomic via Lua script)
- Blocking Redis KEYS command replaced with non-blocking SCAN
- Missing X-User-Id handling in rate limiter (now skips rate limiting for anonymous requests)
