#!/bin/bash
# Double-click this file to update LifeOS.
# It gets the newest version from GitHub, rebuilds the app, and puts
# LifeOS.app in your Applications folder. Your files in Documents/LifeOS
# are never touched.

cd "$(dirname "$0")" || exit 1

fail() {
  echo ""
  echo "Something went wrong: $1"
  echo "Copy the lines above and send them to Claude."
  echo ""
  read -r -p "Press Enter to close this window."
  exit 1
}

echo ""
echo "=== Updating LifeOS ==="
echo ""

if [ -d .git ]; then
  echo "1/4  Getting the newest version from GitHub…"
  git pull --ff-only || fail "couldn't download the newest version."
else
  echo "1/4  (This copy came from a ZIP, so it can't download updates by itself."
  echo "      Follow the one-time setup in README.md to fix that. Building this copy for now.)"
fi

echo "2/4  Fetching the pieces the screens need…"
npm install --no-fund --no-audit || fail "npm install didn't work."

echo "3/4  Building LifeOS.app (the first time can take 20-40 minutes; later ones are faster)…"
npm run app:build || fail "the build didn't finish."

APP="src-tauri/target/release/bundle/macos/LifeOS.app"
[ -d "$APP" ] || fail "the build finished but LifeOS.app wasn't made."

echo "4/4  Putting LifeOS in your Applications folder…"
osascript -e 'tell application "LifeOS" to quit' >/dev/null 2>&1
sleep 1
rm -rf "/Applications/LifeOS.app"
ditto "$APP" "/Applications/LifeOS.app" || fail "couldn't copy LifeOS into Applications."

echo ""
echo "Done! Opening LifeOS…"
open "/Applications/LifeOS.app"
sleep 2
exit 0
