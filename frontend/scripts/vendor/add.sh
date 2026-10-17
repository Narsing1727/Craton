#!/usr/bin/env bash
# Usage: scripts/vendor/add.sh <shadcn add args...>  — installs registry components with npm instead of bun,
# then restores bun.lock and any of our themed files a registry tried to overwrite.
set -u
FE="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$(mktemp -d)"  # snapshot of our files, restored after the install
cd "$FE"
mkdir -p "$BK/ui" "$BK/hooks" "$BK/lib" "$BK/top"
cp components/ui/*.tsx "$BK/ui/"; cp hooks/* "$BK/hooks/"; cp lib/* "$BK/lib/"; cp components/*.tsx "$BK/top/"; cp app/globals.css components.json "$BK/"
export npm_config_package_lock=false npm_config_legacy_peer_deps=true npm_config_audit=false npm_config_fund=false
mv bun.lock bun.lock.hold
timeout 600 ./node_modules/.bin/shadcn.exe add "$@" -y -o < /dev/null 2>&1 | grep -vE "^\s*$" | tail -25
mv bun.lock.hold bun.lock
rm -f package-lock.json
for f in "$BK"/ui/*.tsx; do b=$(basename "$f"); cmp -s "$f" "components/ui/$b" || { echo "  restored themed components/ui/$b"; cp "$f" "components/ui/$b"; }; done
for d in hooks lib; do for f in "$BK"/$d/*; do b=$(basename "$f"); cmp -s "$f" "$d/$b" || { echo "  restored $d/$b"; cp "$f" "$d/$b"; }; done; done
for f in "$BK"/top/*.tsx; do b=$(basename "$f"); cmp -s "$f" "components/$b" || { echo "  restored components/$b"; cp "$f" "components/$b"; }; done
cmp -s "$BK/globals.css" app/globals.css || echo "  !! globals.css changed (review)"
cmp -s "$BK/components.json" components.json || echo "  !! components.json changed (review)"
