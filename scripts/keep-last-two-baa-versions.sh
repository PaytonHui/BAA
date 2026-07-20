#!/usr/bin/env bash
# Keep only the two newest BAA versions on this Mac.
#
# Scans: ~/Applications, /Applications, Desktop, Downloads, BAA/releases
# Keeps: DMG/zip for the two highest versions + ~/Applications/BAA.app
# Removes: older packages + extra BAA.app copies
# Safe: does not delete project source (only packages under releases/)
#
# Compatible with macOS /bin/bash 3.2
set -eu

HOME_DIR="${HOME:-/Users/paytonhui}"
REPO="${BAA_REPO:-$HOME_DIR/BAA}"
KEEP_N=2
PREFERRED="$HOME_DIR/Applications/BAA.app"

version_key() {
  local v="${1#v}"
  local a=0 b=0 c=0
  local rest="$v"
  a="${rest%%.*}"
  rest="${rest#*.}"
  if [ "$rest" != "$v" ]; then
    b="${rest%%.*}"
    rest="${rest#*.}"
    if [ "$rest" != "${b}" ] && [ -n "$rest" ]; then
      c="${rest%%.*}"
    fi
  fi
  a=$(printf '%s' "$a" | tr -cd '0-9'); a=${a:-0}
  b=$(printf '%s' "$b" | tr -cd '0-9'); b=${b:-0}
  c=$(printf '%s' "$c" | tr -cd '0-9'); c=${c:-0}
  printf '%05d%05d%05d' "$a" "$b" "$c"
}

app_version() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
    "$1/Contents/Info.plist" 2>/dev/null || true
}

PKG_LIST=$(mktemp)
APP_LIST=$(mktemp)
trap 'rm -f "$PKG_LIST" "$APP_LIST"' EXIT

scan_packages() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  local f base ver
  # Use find so empty globs never break set -e
  find "$dir" -maxdepth 1 \( -name 'BAA*.dmg' -o -name 'BAA*.zip' -o -name 'baa*.dmg' -o -name 'baa*.zip' \) -type f 2>/dev/null | while read -r f; do
    base=$(basename "$f")
    ver=$(printf '%s' "$base" | sed -n 's/.*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -1)
    [ -n "$ver" ] || continue
    printf '%s|%s\n' "$ver" "$f"
  done >>"$PKG_LIST"
}

scan_apps() {
  local p d
  for p in \
    "$HOME_DIR/Applications/BAA.app" \
    "/Applications/BAA.app" \
    "$HOME_DIR/Desktop/BAA.app" \
    "$HOME_DIR/Downloads/BAA.app"
  do
    if [ -d "$p" ]; then
      printf '%s\n' "$p" >>"$APP_LIST"
    fi
  done
  for d in "$HOME_DIR/Applications" "$HOME_DIR/Desktop" "$HOME_DIR/Downloads" /Applications; do
    [ -d "$d" ] || continue
    find "$d" -maxdepth 1 \( -name 'BAA-*.app' -o -name 'BAA_*.app' \) -type d 2>/dev/null | while read -r p; do
      printf '%s\n' "$p" >>"$APP_LIST"
    done
  done
}

scan_packages "$REPO/releases"
scan_packages "$HOME_DIR/Downloads"
scan_packages "$HOME_DIR/Desktop"
scan_packages "$HOME_DIR/Applications"
scan_apps

# Unique versions
VER_FILE=$(mktemp)
trap 'rm -f "$PKG_LIST" "$APP_LIST" "$VER_FILE"' EXIT

if [ -s "$PKG_LIST" ]; then
  cut -d'|' -f1 "$PKG_LIST" >>"$VER_FILE"
fi
if [ -s "$APP_LIST" ]; then
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    v=$(app_version "$p")
    [ -n "$v" ] && printf '%s\n' "$v" >>"$VER_FILE"
  done <"$APP_LIST"
fi

if [ ! -s "$VER_FILE" ]; then
  echo "No versioned BAA installs/packages found."
  exit 0
fi

SORT_TMP=$(mktemp)
trap 'rm -f "$PKG_LIST" "$APP_LIST" "$VER_FILE" "$SORT_TMP"' EXIT
sort -u "$VER_FILE" | while IFS= read -r v; do
  [ -z "$v" ] && continue
  printf '%s %s\n' "$(version_key "$v")" "$v"
done | sort -r | awk '{print $2}' >"$SORT_TMP"

KEEP_FILE=$(mktemp)
trap 'rm -f "$PKG_LIST" "$APP_LIST" "$VER_FILE" "$SORT_TMP" "$KEEP_FILE"' EXIT
head -n "$KEEP_N" "$SORT_TMP" >"$KEEP_FILE"
KEEP=$(tr '\n' ' ' <"$KEEP_FILE" | xargs)
echo "Keeping last $KEEP_N version(s): $KEEP"

should_keep() {
  grep -qxF "$1" "$KEEP_FILE"
}

if [ -s "$PKG_LIST" ]; then
  while IFS= read -r e; do
    [ -z "$e" ] && continue
    ver="${e%%|*}"
    path="${e#*|}"
    if should_keep "$ver"; then
      echo "  keep package   v$ver  $path"
    else
      echo "  delete package v$ver  $path"
      rm -f "$path"
    fi
  done <"$PKG_LIST"
fi

if [ -s "$APP_LIST" ]; then
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    ver=$(app_version "$p")
    [ -n "$ver" ] || continue

    if ! should_keep "$ver"; then
      echo "  delete app     v$ver  $p"
      rm -rf "$p"
      continue
    fi

    if [ "$p" = "$PREFERRED" ]; then
      echo "  keep app       v$ver  $p  (primary)"
      continue
    fi

    echo "  delete app     v$ver  $p  (extra copy)"
    rm -rf "$p"
  done <"$APP_LIST"
fi

echo "Done. Primary app: $PREFERRED"
if [ -d "$PREFERRED" ]; then
  echo "  version: $(app_version "$PREFERRED")"
fi
