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

# Colour only when stdout is a terminal, so redirecting the installer into a
# log leaves readable text rather than escape sequences.
if [ -t 1 ]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  RESET=$'\033[0m'
else
  BOLD='' DIM='' RED='' GREEN='' YELLOW='' RESET=''
fi

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

# `/releases/latest` redirects to the tag, and following that redirect needs no
# API call — so it is not subject to the 60-requests-per-hour limit that anyone
# behind a shared address (an office NAT, a university, CI) runs into. The API
# is kept only as a fallback.
latest_from_redirect() {
  curl -fsSLI -o /dev/null -w '%{url_effective}' \
    "https://github.com/$REPO/releases/latest" 2> /dev/null \
    | sed -E 's#.*/tag/v?([^/]+)$#\1#'
}

latest_from_api() {
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2> /dev/null \
    | grep -m1 '"tag_name"' \
    | sed -E 's/.*"tag_name" *: *"v?([^"]+)".*/\1/'
}

if [ -n "${WISHPOSTGRES_VERSION:-}" ]; then
  VERSION="${WISHPOSTGRES_VERSION#v}"
else
  say "Looking up the latest release"
  VERSION=$(latest_from_redirect || true)

  # A redirect that never reached a /tag/ URL leaves the whole URL behind.
  case "$VERSION" in
    "" | *[!0-9A-Za-z.+-]*) VERSION=$(latest_from_api || true) ;;
  esac

  [ -n "$VERSION" ] || die "could not work out the latest version. Check your \
network, or pass one explicitly: WISHPOSTGRES_VERSION=1.0.0"
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

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum > /dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl > /dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  fi
}

verify() {
  local name="$1"
  if ! curl -fsSL -o "$WORK/SHA256SUMS" "$BASE/SHA256SUMS" 2> /dev/null; then
    warn "no SHA256SUMS published for this release; skipping verification."
    return 0
  fi
  say "Verifying checksum"

  local expected
  # The name is matched literally: a `.` in it must not act as a wildcard.
  expected=$(grep -E "[ /]$(printf '%s' "$name" | sed 's/[.[\*^$]/\\&/g')\$" \
    "$WORK/SHA256SUMS" | awk '{print $1}' | head -1)
  [ -n "$expected" ] || {
    warn "$name is not listed in SHA256SUMS; skipping verification."
    return 0
  }

  local actual
  actual=$(sha256_of "$WORK/$name")
  # Distinguish "no tool to hash with" from "the hashes differ" — reporting a
  # missing sha256sum as a checksum mismatch would send people hunting a
  # corrupt download that is perfectly fine.
  [ -n "$actual" ] || {
    warn "no sha256sum, shasum or openssl found; skipping verification."
    return 0
  }
  [ "$expected" = "$actual" ] || die "checksum mismatch for $name — refusing to install.
  expected $expected
  got      $actual"
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
    # DEBIAN_FRONTEND, because this often runs from `curl | bash` where there is
    # no usable stdin for a configuration prompt to read from.
    $SUDO apt-get update -qq || true
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y "$WORK/$PACKAGE"
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

    # Lift the icons out of the AppImage, or the launcher entry below would
    # point at an icon name nothing on the system provides. The whole hicolor
    # tree is copied rather than one file, so each size lands in the directory
    # that describes it — exactly what the .deb installs. Best effort: a failure
    # here costs an icon, not the installation.
    (
      cd "$WORK" && chmod +x "$PACKAGE" \
        && ./"$PACKAGE" --appimage-extract 'usr/share/icons/*' > /dev/null 2>&1
    ) || true

    theme="$WORK/squashfs-root/usr/share/icons/hicolor"
    if [ -d "$theme" ]; then
      mkdir -p "$HOME/.local/share/icons/hicolor"
      cp -r "$theme/." "$HOME/.local/share/icons/hicolor/"
      command -v gtk-update-icon-cache > /dev/null 2>&1 \
        && gtk-update-icon-cache -qtf "$HOME/.local/share/icons/hicolor" 2> /dev/null || true
    else
      warn "could not read the icons out of the AppImage; the launcher entry will have none."
    fi

    # A desktop entry, so it shows up in the launcher like a real application.
    desktop="$HOME/.local/share/applications/wishpostgres.desktop"
    mkdir -p "$(dirname "$desktop")"
    cat > "$desktop" << ENTRY
[Desktop Entry]
Type=Application
Name=WishPostgres
GenericName=PostgreSQL Client
Comment=A fast, lightweight PostgreSQL desktop manager
Exec=$PREFIX/wishpostgres %U
Icon=wishpostgres
Terminal=false
StartupNotify=true
StartupWMClass=wishpostgres
Categories=Development;Database;GTK;
Keywords=postgres;postgresql;sql;database;db;query;
ENTRY

    command -v update-desktop-database > /dev/null 2>&1 \
      && update-desktop-database -q "$HOME/.local/share/applications" 2> /dev/null || true

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
