#!/bin/bash
# Ships whatever's already in vendored/ (every version cut so far via
# cut-version.sh) -- does NOT auto-vendor. Cutting a new season is a
# deliberate, separate step: `sh cut-version.sh <N>` before releasing.
set -e
cd "$(dirname "$0")"
TIMESTAMP=$(date +%s)
zip -vr replay-release-prod-${TIMESTAMP}.zip index.js vendored -x "*.DS_Store"
aws lambda update-function-code --function-name=t9-wizard-replay-prod --zip-file=fileb://replay-release-prod-${TIMESTAMP}.zip --no-cli-pager
