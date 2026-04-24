#!/bin/bash
# Creates a session summary stub for Claude to fill in before clearing context.
# Usage: .claude/save-session.sh "short-description"
DATE=$(date +%Y-%m-%d)
DESC=${1:-"session"}
FILE=".claude/sessions/$DATE-$DESC.md"

BRANCH=$(git branch --show-current 2>/dev/null)
LAST_COMMIT=$(git log --oneline -1 2>/dev/null)
CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | tr '\n' ', ' | sed 's/,$//')

cat > "$FILE" <<EOF
# Session: $DESC
**Date:** $DATE
**Branch:** $BRANCH | **Last commit:** $LAST_COMMIT

## What was done
<!-- fill in -->

## Current state
<!-- fill in -->

## What's next
<!-- fill in -->

## Key files changed
$CHANGED
EOF

echo "Created $FILE"
cat "$FILE"
