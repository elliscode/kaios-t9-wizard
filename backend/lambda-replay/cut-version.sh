#!/bin/bash
# Freezes the current frontend-v3/js/ game logic as a new, immutable API
# version snapshot under vendored/v<N>/. This is a deliberate, one-per-season
# action -- NOT something releases do automatically (see dev-release.sh/
# prod-release.sh, which just ship whatever's already been cut).
#
# Usage: sh cut-version.sh <N> [--force]
set -e
cd "$(dirname "$0")"

VERSION="$1"
FORCE="$2"

if [ -z "$VERSION" ]; then
  echo "Usage: sh cut-version.sh <N> [--force]" >&2
  exit 1
fi

DEST="vendored/v${VERSION}"
SRC=../../frontend-v3

if [ -d "$DEST" ] && [ "$FORCE" != "--force" ]; then
  echo "vendored/v${VERSION}/ already exists -- refusing to overwrite a shipped season's snapshot." >&2
  echo "Already-submitted (and in-flight) runs under this version depend on it staying exactly as it was." >&2
  echo "If you're SURE you want to overwrite it (e.g. fixing a mistake before anyone has played this version), re-run with --force." >&2
  exit 1
fi

# index.js's SOURCE_FILE_NAMES is the single source of truth for which files
# a version snapshot contains -- it's also literally what the replay Lambda
# loads at runtime, so the set of files vendored here can never silently
# drift out of sync with the set of files that actually get replayed.
FILES=$(node -e "console.log(require('./index.js').SOURCE_FILE_NAMES.join(' '))")

# *-data.js lives in frontend-v3/data/, everything else in frontend-v3/js/.
src_path() {
  case "$1" in
    *-data.js) echo "$SRC/data/$1" ;;
    *) echo "$SRC/js/$1" ;;
  esac
}

# Re-cutting an existing version is otherwise a silent overwrite with zero
# feedback about what, if anything, actually changed. Print a diff summary
# first so that's never left to guesswork -- a suspected vendored/source
# mismatch once took real manual effort (diffing files, digging through git
# log) to rule out, purely because this script gave no indication either way.
if [ -d "$DEST" ]; then
  echo "Re-cutting version ${VERSION} -- diffing against the existing snapshot:"
  CHANGED=0
  for f in $FILES; do
    if ! diff -q "$DEST/$f" "$(src_path "$f")" > /dev/null 2>&1; then
      echo "  CHANGED: $f"
      CHANGED=1
    fi
  done
  if [ "$CHANGED" -eq 0 ]; then
    echo "  (no changes -- every vendored file already matches the current source)"
  fi
fi

rm -rf "$DEST"
mkdir -p "$DEST"

for f in $FILES; do
  cp "$(src_path "$f")" "$DEST/$f"
done

# Verify the copy actually landed correctly -- cheap, and catches a
# disk/permissions error rather than silently shipping a partial or stale
# snapshot.
for f in $FILES; do
  if ! diff -q "$DEST/$f" "$(src_path "$f")" > /dev/null 2>&1; then
    echo "verification failed: $DEST/$f does not match $(src_path "$f")" >&2
    exit 1
  fi
done

echo "Cut version ${VERSION}: vendored $(ls $DEST | wc -l | tr -d ' ') files into $DEST/"
