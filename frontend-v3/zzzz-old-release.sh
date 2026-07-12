#!/usr/bin/env bash
set -euo pipefail

BUCKET="daniel-townsend-elliscode"
PREFIX="t9-wizard"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v aws >/dev/null 2>&1; then
  echo "Error: aws CLI not found on PATH." >&2
  exit 1
fi

files=$(find . \
  -type d \( -name '.git' -o -name 'node_modules' \) -prune -o \
  -type f \( -name '*.js' -o -name '*.html' -o -name '*.webapp' -o -name '*.css' \) -print)

if [ -z "$files" ]; then
  echo "No matching files found." >&2
  exit 1
fi

while IFS= read -r file; do
  rel_path="${file#./}"
  dest="s3://$BUCKET/$PREFIX/$rel_path"
  echo "Uploading $rel_path -> $dest"
  aws s3 cp "$file" "$dest"
done <<< "$files"

echo "Done. Uploaded to s3://$BUCKET/$PREFIX/"
