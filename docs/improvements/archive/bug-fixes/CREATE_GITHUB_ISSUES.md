# Bug Fixes to Create as GitHub Issues

These bug fix documents should be converted to GitHub issues for proper tracking:

## 1. Webhook Personality Detection Fix
**File**: WEBHOOK_PERSONALITY_DETECTION_FIX.md
**Priority**: High
**Issue Title**: "Fix webhook personality detection in DMs"
**Labels**: bug, webhooks, personality

## 2. Multiple Media API Fix  
**File**: MULTIPLE_MEDIA_API_FIX.md
**Priority**: Medium
**Issue Title**: "Handle multiple media attachments in AI requests"
**Labels**: bug, media, ai-service

## 3. Open Handles Issue
**File**: OPEN_HANDLES_ISSUE.md
**Priority**: Low
**Issue Title**: "Investigate and fix open handles preventing clean shutdown"
**Labels**: bug, testing, performance

## Creation Command Examples

```bash
# Example commands to create these issues
gh issue create --title "Fix webhook personality detection in DMs" --body "See archive/bug-fixes/WEBHOOK_PERSONALITY_DETECTION_FIX.md" --label bug,webhooks,personality

gh issue create --title "Handle multiple media attachments in AI requests" --body "See archive/bug-fixes/MULTIPLE_MEDIA_API_FIX.md" --label bug,media,ai-service

gh issue create --title "Investigate and fix open handles preventing clean shutdown" --body "See archive/bug-fixes/OPEN_HANDLES_ISSUE.md" --label bug,testing,performance
```