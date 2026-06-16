#!/bin/bash
# Run this before every git push to catch build errors locally
# Usage: ./check-build.sh

echo "Running build check..."
cd "$(dirname "$0")"

# Copy latest App.jsx if it exists in Downloads
if [ -f ~/Downloads/App.jsx ]; then
  cp ~/Downloads/App.jsx src/App.jsx
  echo "Updated App.jsx from Downloads"
fi

npm run build 2>&1

if [ $? -eq 0 ]; then
  echo ""
  echo "✓ BUILD PASSED - safe to push"
  echo ""
  echo "Run: git add . && git commit -m 'your message' && git push"
else
  echo ""
  echo "✗ BUILD FAILED - fix errors above before pushing"
fi
