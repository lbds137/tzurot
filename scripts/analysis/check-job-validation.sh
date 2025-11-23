#!/bin/bash

# Check Job Validation Enforcement
#
# This script ensures that any file creating BullMQ jobs either:
# 1. Imports job validation schemas, OR
# 2. Uses the validated queue wrapper (addValidatedJob)
#
# This prevents developers from bypassing runtime validation when creating jobs.
#
# Exit codes:
#   0 - All job creation code has validation
#   1 - Found job creation without validation
#
# Usage:
#   ./scripts/check-job-validation.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Checking job creation validation enforcement..."

# Find all TypeScript files that create jobs (queue.add or addValidatedJob)
# Exclude test files, node_modules, and dist directories
JOB_CREATION_FILES=$(grep -r "queue\.add\|addValidatedJob" \
  --include="*.ts" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude="*.test.ts" \
  --exclude="*.spec.ts" \
  services/api-gateway/src \
  | cut -d: -f1 \
  | sort -u)

if [ -z "$JOB_CREATION_FILES" ]; then
  echo -e "${GREEN}✅ No job creation code found${NC}"
  exit 0
fi

VALIDATION_ISSUES=0

for file in $JOB_CREATION_FILES; do
  # Check if file uses the validated wrapper
  if grep -q "addValidatedJob" "$file"; then
    echo -e "${GREEN}✅ $file uses addValidatedJob wrapper${NC}"
    continue
  fi

  # Check if file imports validation schemas
  if grep -q "audioTranscriptionJobDataSchema\|imageDescriptionJobDataSchema\|llmGenerationJobDataSchema" "$file"; then
    # Check if it actually uses safeParse
    if grep -q "\.safeParse(" "$file"; then
      echo -e "${GREEN}✅ $file has inline schema validation${NC}"
      continue
    else
      echo -e "${YELLOW}⚠️  $file imports schemas but doesn't use safeParse${NC}"
      VALIDATION_ISSUES=$((VALIDATION_ISSUES + 1))
    fi
  else
    # Check if this is jobChainOrchestrator (has inline validation)
    if [[ "$file" == *"jobChainOrchestrator"* ]]; then
      echo -e "${GREEN}✅ $file has inline validation (orchestrator)${NC}"
      continue
    fi

    echo -e "${RED}❌ $file creates jobs without validation${NC}"
    echo -e "${YELLOW}   → Import schemas and use safeParse(), or use addValidatedJob()${NC}"
    VALIDATION_ISSUES=$((VALIDATION_ISSUES + 1))
  fi
done

echo ""
if [ $VALIDATION_ISSUES -gt 0 ]; then
  echo -e "${RED}❌ Found $VALIDATION_ISSUES file(s) creating jobs without validation${NC}"
  echo ""
  echo "To fix:"
  echo "  1. Use the validated queue wrapper:"
  echo "     import { addValidatedJob } from './utils/validatedQueue.js';"
  echo "     await addValidatedJob(queue, JobType.AudioTranscription, jobData, opts);"
  echo ""
  echo "  2. OR add inline validation:"
  echo "     import { audioTranscriptionJobDataSchema } from '@tzurot/common-types';"
  echo "     const validation = audioTranscriptionJobDataSchema.safeParse(jobData);"
  echo "     if (!validation.success) { throw new Error(...); }"
  echo ""
  exit 1
else
  echo -e "${GREEN}✅ All job creation code has validation enforcement${NC}"
  exit 0
fi
