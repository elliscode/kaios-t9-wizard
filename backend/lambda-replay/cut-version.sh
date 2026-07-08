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

if [ -d "$DEST" ] && [ "$FORCE" != "--force" ]; then
  echo "vendored/v${VERSION}/ already exists -- refusing to overwrite a shipped season's snapshot." >&2
  echo "Already-submitted (and in-flight) runs under this version depend on it staying exactly as it was." >&2
  echo "If you're SURE you want to overwrite it (e.g. fixing a mistake before anyone has played this version), re-run with --force." >&2
  exit 1
fi

SRC=../../frontend-v3

rm -rf "$DEST"
mkdir -p "$DEST"

for f in layout.js rng.js t9.js words.js sentences.js enemy.js powerup.js boss.js colors.js input.js save.js game.js; do
  cp "$SRC/js/$f" "$DEST/$f"
done

for f in words-data.js sentences-data.js; do
  cp "$SRC/data/$f" "$DEST/$f"
done

echo "Cut version ${VERSION}: vendored $(ls $DEST | wc -l | tr -d ' ') files into $DEST/"
