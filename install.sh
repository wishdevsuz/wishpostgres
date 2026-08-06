#!/usr/bin/env bash
#
# WishPostgres installer.
#
#   curl -fsSL https://wishdevsuz.github.io/wish-pgAdmin/install.sh | bash
#
# Detects the distribution, picks the matching package from the latest GitHub
# release, verifies its checksum and installs it. Falls back to the AppImage on
# distributions without dpkg or rpm.
#
# Environment:
#   WISHPOSTGRES_VERSION   install a specific version instead of the latest
#   WISHPOSTGRES_METHOD    force one of: deb, rpm, appimage
#   WISHPOSTGRES_PREFIX    where the AppImage goes (default ~/.local/bin)

set -euo pipefail

REPO="wishdevsuz/wish-pgAdmin"
PREFIX="${WISHPOSTGRES_PREFIX:-$HOME/.local/bin}"

BOLD=$'\033[1m'
DIM=$'\033[2m'
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

say() { printf '%s\n' "${BOLD}==>${RESET} $*"; }
note() { printf '%s\n' "    ${DIM}$*${RESET}"; }
warn() { printf '%s\n' "${YELLOW}warning:${RESET} $*" >&2; }
die() {
  printf '%s\n' "${RED}error:${RESET} $*" >&2
  exit 1
}

need() {
  command -v "$1" > /dev/null 2>&1 || die "\`$1\` is required but was not found."
}

# ---------------------------------------------------------------- preflight --

[ "$(uname -s)" = "Linux" ] || die "WishPostgres currently ships Linux builds only."

case "$(uname -m)" in
  x86_64 | amd64) ;;
  *) die "no build for $(uname -m) yet — only x86_64. Build from source instead: https://github.com/$REPO#build" ;;
esac

need curl

if [ "$(id -u)" = "0" ]; then
  SUDO=""
else
  if command -v sudo > /dev/null 2>&1; then
    SUDO="sudo"
  else
    SUDO=""
    warn "sudo was not found; package installation may fail without root."
  fi
fi

# ------------------------------------------------------------------ version --

if [ -n "${WISHPOSTGRES_VERSION:-}" ]; then
  VERSION="${WISHPOSTGRES_VERSION#v}"
else
  say "Looking up the latest release"
  VERSION=$(
    curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
      | grep -m1 '"tag_name"' \
      | sed -E 's/.*"tag_name" *: *"v?([^"]+)".*/\1/'
  ) || die "could not reach the GitHub release API."
  [ -n "$VERSION" ] || die "could not work out the latest version."
fi

BASE="https://github.com/$REPO/releases/download/v$VERSION"
note "version $VERSION"

# ------------------------------------------------------------------- method --

if [ -n "${WISHPOSTGRES_METHOD:-}" ]; then
  METHOD="$WISHPOSTGRES_METHOD"
elif command -v dpkg > /dev/null 2>&1 && command -v apt-get > /dev/null 2>&1; then
  METHOD="deb"
elif command -v rpm > /dev/null 2>&1; then
  METHOD="rpm"
else
  METHOD="appimage"
fi

# ----------------------------------------------------------------- download --

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

download() {
  local name="$1"
  say "Downloading $name"
  curl -fSL --progress-bar -o "$WORK/$name" "$BASE/$name" \
    || die "download failed: $BASE/$name"
}

verify() {
  local name="$1"
  if ! curl -fsSL -o "$WORK/SHA256SUMS" "$BASE/SHA256SUMS" 2> /dev/null; then
    warn "no SHA256SUMS published for this release; skipping verification."
    return 0
  fi
  say "Verifying checksum"
  local expected
  expected=$(grep -E "[ /]${name}\$" "$WORK/SHA256SUMS" | awk '{print $1}' | head -1)
  [ -n "$expected" ] || {
    warn "$name is not listed in SHA256SUMS; skipping verification."
    return 0
  }
  local actual
  actual=$(sha256sum "$WORK/$name" | awk '{print $1}')
  [ "$expected" = "$actual" ] || die "checksum mismatch for $name — refusing to install."
  note "ok"
}

# ------------------------------------------------------------------ install --

case "$METHOD" in
  deb)
    PACKAGE="wishpostgres_${VERSION}_amd64.deb"
    download "$PACKAGE"
    verify "$PACKAGE"
    say "Installing with apt"
    # `apt install ./file.deb` resolves the dependencies; `dpkg -i` would not.
    $SUDO apt-get update -qq || true
    $SUDO apt-get install -y "$WORK/$PACKAGE"
    ;;

  rpm)
    PACKAGE="wishpostgres-${VERSION}-1.x86_64.rpm"
    download "$PACKAGE"
    verify "$PACKAGE"
    say "Installing"
    if command -v dnf > /dev/null 2>&1; then
      $SUDO dnf install -y "$WORK/$PACKAGE"
    elif command -v zypper > /dev/null 2>&1; then
      $SUDO zypper --non-interactive install --allow-unsigned-rpm "$WORK/$PACKAGE"
    else
      $SUDO rpm -Uvh "$WORK/$PACKAGE"
    fi
    ;;

  appimage)
    PACKAGE="WishPostgres-${VERSION}-x86_64.AppImage"
    download "$PACKAGE"
    verify "$PACKAGE"
    say "Installing to $PREFIX"
    mkdir -p "$PREFIX"
    install -m755 "$WORK/$PACKAGE" "$PREFIX/wishpostgres"

    # A desktop entry, so it shows up in the launcher like a real application.
    desktop="$HOME/.local/share/applications/wishpostgres.desktop"
    mkdir -p "$(dirname "$desktop")"
    cat > "$desktop" << ENTRY
[Desktop Entry]
Type=Application
Name=WishPostgres
Comment=A fast, lightweight PostgreSQL desktop manager
Exec=$PREFIX/wishpostgres
Icon=wishpostgres
Terminal=false
Categories=Development;Database;
ENTRY

    case ":$PATH:" in
      *":$PREFIX:"*) ;;
      *) warn "$PREFIX is not on your PATH. Add it with: export PATH=\"$PREFIX:\$PATH\"" ;;
    esac
    ;;

  *)
    die "unknown install method \`$METHOD\` (expected deb, rpm or appimage)."
    ;;
esac

printf '\n%s\n' "${GREEN}WishPostgres $VERSION is installed.${RESET}"
note "Start it from your application launcher, or run: wishpostgres"
note "Backup and restore also need the PostgreSQL client tools (pg_dump, psql)."
