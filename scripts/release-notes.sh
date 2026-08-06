#!/usr/bin/env bash
#
# Compose the GitHub release body.
#
# The per-version "what changed" section is taken from CHANGELOG.md, so the
# changelog stays the single place a change is written down. Everything else —
# how to install, what each file is, how to verify a download — is the same for
# every release and lives here.
#
# Usage: VERSION=1.0.0 TAG=v1.0.0 scripts/release-notes.sh > release-notes.md

set -euo pipefail

VERSION="${VERSION:?VERSION is required}"
TAG="${TAG:-v$VERSION}"
REPO="${REPO:-wishdevsuz/wish-pgAdmin}"
PAGES="${PAGES:-https://wishdevsuz.github.io/wish-pgAdmin}"

# Pull the section for this version out of the changelog: everything between
# `## [x.y.z]` and the next `## [` heading.
changelog() {
  if [ -f CHANGELOG.md ]; then
    awk -v version="$VERSION" '
      $0 ~ "^## \\[" version "\\]" { collecting = 1; next }
      collecting && /^## \[/ { exit }
      collecting { print }
    ' CHANGELOG.md | sed -e '/./,$!d'
  fi
}

cat << HEADER
## WishPostgres $VERSION

A fast, lightweight PostgreSQL desktop manager for Linux. Native Tauri window,
Rust database core, no bundled browser engine and no server process.

## Install

### Debian, Ubuntu, Mint, Pop!_OS — apt

\`\`\`bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL $PAGES/wishpostgres.gpg | sudo tee /etc/apt/keyrings/wishpostgres.gpg > /dev/null
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/wishpostgres.gpg] $PAGES/apt stable main" \\
  | sudo tee /etc/apt/sources.list.d/wishpostgres.list > /dev/null
sudo apt update
sudo apt install wishpostgres
\`\`\`

Added once, \`apt upgrade\` keeps WishPostgres current with everything else.

### Any distribution — one line

\`\`\`bash
curl -fsSL $PAGES/install.sh | bash
\`\`\`

Detects your distribution, picks the right package below, checks its SHA-256
against \`SHA256SUMS\` and installs it. Falls back to the AppImage where there is
no \`dpkg\` or \`rpm\`.

### By hand

\`\`\`bash
# Debian / Ubuntu
sudo apt install ./wishpostgres_${VERSION}_amd64.deb

# Fedora / RHEL / openSUSE
sudo dnf install ./wishpostgres-${VERSION}-1.x86_64.rpm

# Anywhere else
chmod +x WishPostgres-${VERSION}-x86_64.AppImage
./WishPostgres-${VERSION}-x86_64.AppImage
\`\`\`

## What is in this release

| File | For | Notes |
| --- | --- | --- |
| \`wishpostgres_${VERSION}_amd64.deb\` | Debian, Ubuntu and derivatives | Installs to \`/usr/bin\`, adds a launcher entry, pulls in its dependencies |
| \`wishpostgres-${VERSION}-1.x86_64.rpm\` | Fedora, RHEL, openSUSE | Same layout as the \`.deb\` |
| \`WishPostgres-${VERSION}-x86_64.AppImage\` | Every other distribution | Self-contained, no installation, no root |
| \`wishpostgres-${VERSION}-x86_64-linux.tar.gz\` | Manual installs and packagers | The bare binary, \`LICENSE\` and \`README.md\` |
| \`SHA256SUMS\` | Everyone | SHA-256 of each file above |

All builds are x86_64 and produced by GitHub Actions from the \`$TAG\` tag —
see the run linked at the bottom of this page for the full log.

## Verify a download

\`\`\`bash
curl -fLO https://github.com/$REPO/releases/download/$TAG/SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
\`\`\`

## Requirements

- **glibc 2.35 or newer** — Ubuntu 22.04 and later, Debian 12 and later, Fedora 36 and later
- **WebKitGTK 4.1** — \`libwebkit2gtk-4.1-0\`, pulled in automatically by the \`.deb\` and \`.rpm\`
- **PostgreSQL 12 or newer** on the server side
- **\`pg_dump\` and \`psql\`** only if you use backup and restore (\`sudo apt install postgresql-client\`)

HEADER

notes="$(changelog)"
if [ -n "$notes" ]; then
  printf '## What changed\n\n%s\n\n' "$notes"
fi

cat << FOOTER
## Uninstall

\`\`\`bash
sudo apt remove wishpostgres        # or: sudo dnf remove wishpostgres
rm -rf ~/.config/dev.wishpostgres.app   # settings, saved connections, history
\`\`\`

Passwords live in your OS keyring and are removed with the connection that owns
them; the config directory above holds everything else.

---

Full documentation is in the [README](https://github.com/$REPO#readme).
Found a problem? [Open an issue](https://github.com/$REPO/issues/new).
FOOTER
