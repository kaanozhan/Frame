#!/usr/bin/env bash
# Verify every row in docs/frame-modifications.md has its claimed marker count
# in the corresponding file. Fails loudly if any mismatch — that means an
# upstream rebase silently dropped one of our edits.
set -euo pipefail
LEDGER="docs/frame-modifications.md"
if [ ! -f "$LEDGER" ]; then
  echo "ledger not found at $LEDGER"
  exit 1
fi
# Skip header rows (start with `|---` or `| Date `). Grep just the data rows.
FAIL=0
while IFS='|' read -r _ _ _ file _ _ count _; do
  file=$(echo "$file" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | tr -d '`')
  count=$(echo "$count" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [ -z "$file" ] || [ -z "$count" ] || [ "$file" = "File" ] || ! [[ "$count" =~ ^[0-9]+$ ]]; then
    continue
  fi
  if [ ! -f "$file" ]; then
    echo "FAIL: ledger names $file but file does not exist"
    FAIL=1
    continue
  fi
  actual=$(grep -c 'supervisor-mod' "$file" || echo 0)
  if [ "$actual" -ne "$count" ]; then
    echo "FAIL: $file expected $count supervisor-mod markers, found $actual"
    FAIL=1
  fi
done < "$LEDGER"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
echo "OK: all ledger rows verified"
