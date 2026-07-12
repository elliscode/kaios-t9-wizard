TIMESTAMP=$(date +%s)
zip -r t9wizard-${TIMESTAMP}.zip . \
  -x "*.zip" \
  -x "*.DS_Store" \
  -x "*.md" \
  -x "*release.sh" \
  -x "final-menu.png" \
  -x "assets/banner.png" \
  -x "assets/screenshot*.png"
