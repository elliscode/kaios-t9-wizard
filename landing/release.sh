#!/usr/bin/env bash
set -euo pipefail

# The landing page (https://t9-wizard.elliscode.com/) lives in its own bucket,
# at the bucket root -- separate from s3/release.sh's
# daniel-townsend-elliscode/t9-wizard/ prefix, which this never touches.
BUCKET="daniel-townsend-t9-wizard"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v aws >/dev/null 2>&1; then
  echo "Error: aws CLI not found on PATH." >&2
  exit 1
fi

files=$(find . \
  -type d \( -name '.git' -o -name 'node_modules' \) -prune -o \
  -type f \( -name '*.js' -o -name '*.html' -o -name '*.css' \
          -o -name '*.png' -o -name '*.jpg' -o -name '*.webp' \
          -o -name '*.webmanifest' \) -print)

if [ -z "$files" ]; then
  echo "No matching files found." >&2
  exit 1
fi

while IFS= read -r file; do
  rel_path="${file#./}"
  dest="s3://$BUCKET/$rel_path"
  echo "Uploading $rel_path -> $dest"
  # update.webmanifest is the JScalated/OStore update source for the KaiOS
  # app -- set its type explicitly rather than trusting extension guessing.
  if [[ "$file" == *.webmanifest ]]; then
    aws s3 cp "$file" "$dest" --content-type "application/manifest+json"
  else
    aws s3 cp "$file" "$dest"
  fi
done <<< "$files"

echo "Done. Uploaded to s3://$BUCKET/"
