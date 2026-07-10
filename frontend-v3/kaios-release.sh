TIMESTAMP=$(date +%s)
zip -r t9wizard-${TIMESTAMP}.zip . \
  -x "*.zip" \
  -x "*.DS_Store" \
  -x "*.md" \
  -x "*release.sh" \
  -x "final-menu.png" \
  -x "final-playing.png" \
  -x "final-transition.png"
