#!/bin/bash
# Extract personalities that successfully completed memory import

grep -B 20 "✅ Memory import complete:" bulk-import.log | \
  grep "^Importing:" | \
  cut -d' ' -f2 | \
  sort -u
