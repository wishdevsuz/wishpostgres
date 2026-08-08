<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" height="88" alt="WishPostgres" />

# WishPostgres

**A fast, lightweight and genuinely pleasant PostgreSQL desktop manager for Linux.**

Browse and edit data, design tables, run SQL, move data in and out, and back up
databases — in a single window that starts in under a second.

[![CI](https://github.com/wishdevsuz/wishpostgres/actions/workflows/ci.yml/badge.svg)](https://github.com/wishdevsuz/wishpostgres/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/wishdevsuz/wishpostgres?label=release)](https://github.com/wishdevsuz/wishpostgres/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```bash
curl -fsSL https://wishdevsuz.github.io/wishpostgres/install.sh | bash
```

</div>

---

## Why

Most PostgreSQL GUIs are either a browser app in a costume or an enterprise
console with a thousand nested panels. WishPostgres is neither. It is a native
Tauri window with a Rust core: no bundled Chromium, no Node runtime shipped
alongside, no server process. The release binary is a few megabytes and the
whole database layer is compiled, typed Rust.

Everything a person actually does with a database day to day is reachable in one
or two clicks.

## Features

**Connections**
- Unlimited saved connections with live Connected / Offline status
- Passwords in the OS keyring (Secret Service), with a documented encrypted-file fallback
- Right-click to rename, duplicate, delete, test or connect
- Optional TLS, with a toggle for self-signed certificates
- Per-connection search path and statement timeout

**Data grid**
- Virtualised — 100,000+ rows scroll without dropping a frame
- Sort by any column, multi-column with Shift-click
- Filter builder with twelve operators, all sent as bound parameters
- Search across every column at once
- Resizable columns, double-click a divider to auto-fit, per-column show/hide
- Inline editing: double-click or press Enter, Esc cancels, no dialog
- Multi-row selection, copy cell / row / selection with headers
- Full keyboard navigation and a context menu on every row

**Editing**
- Insert form generated from the real column types — checkbox for `boolean`,
  date picker for `date`, JSON editor for `jsonb`, dropdown for enums, and so on
- Client-side validation before the round trip; PostgreSQL remains the authority
- Rows are identified by primary key, then a unique NOT NULL column, then `ctid`,
  so tables without a key are still editable
- Delete with confirmation, and typed confirmation for wide-reaching deletes

**Table pages** — Browse, Structure, SQL, Indexes, Constraints, Statistics

**Structure editor** — add, rename, retype, drop columns; toggle nullability;
set defaults and comments

**SQL editor**
- CodeMirror 6 with PostgreSQL syntax highlighting, folding and auto-indent
- Table and column autocompletion drawn from the live catalog
- Run the selection, the statement under the cursor, or the whole tab
- Multiple tabs, auto-saved and restored across restarts
- Query history and saved queries, both searchable
- `EXPLAIN` in one click; execution time and affected rows on every run

**Import and export**
- Import CSV, TSV, JSON and Excel with column mapping and a live preview
- Export to CSV, JSON, Excel, `INSERT` statements or a `COPY` block

**Backup and restore** — drives `pg_dump` and `psql` with a real progress bar

**Database overview** — opening a database lands on its contents: every table,
view and function as a searchable card with row counts and sizes, one click from
the data

**Global search** — tables, columns, views, functions and schemas, instantly

**Scope-aware navigation** — switching database or schema closes anything that
belonged to the old one and focuses a schema that actually exists, so the main
pane never shows a relation the sidebar is no longer pointed at. SQL tabs are
deliberately left alone, since they are scratch text rather than bound to one
database.

**Error handling** — every failure shows the message, SQLSTATE, the likely cause
and a concrete suggested fix, with one-click copy

## Screenshots

> Replace these placeholders with your own captures.

| Browse | SQL editor |
| --- | --- |
| _`docs/screenshots/browse.png`_ | _`docs/screenshots/sql.png`_ |

| Structure | Connection |
| --- | --- |
| _`docs/screenshots/structure.png`_ | _`docs/screenshots/connection.png`_ |

## Requirements

- **Node.js** 18 or newer
- **Rust** 1.77 or newer (`rustup` recommended)
- **PostgreSQL** 12 or newer on the server side
- **PostgreSQL client tools** (`pg_dump`, `psql`) — only for backup and restore

### Linux system libraries

Tauri builds against the system WebKit. On Debian and Ubuntu:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

On Fedora:

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel gcc gcc-c++ make
```

On Arch:

```bash
sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl \
  libappindicator-gtk3 librsvg
```

## Install

### Debian, Ubuntu, Mint, Pop!_OS — `apt`

Add the repository once and WishPostgres updates along with everything else on
your system:

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://wishdevsuz.github.io/wishpostgres/wishpostgres.gpg \
  | sudo tee /etc/apt/keyrings/wishpostgres.gpg > /dev/null
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/wishpostgres.gpg] https://wishdevsuz.github.io/wishpostgres/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/wishpostgres.list > /dev/null
sudo apt update
sudo apt install wishpostgres
```

Afterwards `sudo apt upgrade` keeps it current, and `sudo apt remove
wishpostgres` removes it.

### Any distribution — one line

```bash
curl -fsSL https://wishdevsuz.github.io/wishpostgres/install.sh | bash
```

The installer works out your distribution, downloads the matching package from
the latest release, checks its SHA-256 against the published `SHA256SUMS` and
installs it. Where there is no `dpkg` or `rpm` it installs the AppImage into
`~/.local/bin` and adds a launcher entry. Read it first if you would rather not
pipe a script into a shell — it is [`scripts/install.sh`](scripts/install.sh),
and it is short.

Useful variables: `WISHPOSTGRES_VERSION` to pin a version,
`WISHPOSTGRES_METHOD` to force `deb`, `rpm` or `appimage`.

### By hand

Every [release](https://github.com/wishdevsuz/wishpostgres/releases/latest)
carries four files:

| File | For |
| --- | --- |
| `wishpostgres_<version>_amd64.deb` | Debian, Ubuntu and derivatives |
| `wishpostgres-<version>-1.x86_64.rpm` | Fedora, RHEL, openSUSE |
| `WishPostgres-<version>-x86_64.AppImage` | Everything else — no install, no root |
| `wishpostgres-<version>-x86_64-linux.tar.gz` | The bare binary, for packagers |

```bash
sudo apt install ./wishpostgres_1.0.0_amd64.deb     # Debian / Ubuntu
sudo dnf install ./wishpostgres-1.0.0-1.x86_64.rpm  # Fedora / RHEL
chmod +x WishPostgres-1.0.0-x86_64.AppImage && ./WishPostgres-1.0.0-x86_64.AppImage
```

Verify a download against the release's `SHA256SUMS`:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

### From source

```bash
git clone https://github.com/wishdevsuz/wishpostgres.git
cd wishpostgres
npm install
npm run tauri build
```

## Development

```bash
npm run tauri dev
```

Vite serves the frontend with hot reload on port 1420; the Rust side rebuilds on
change. To work on the frontend alone, `npm run dev` opens it in a browser,
though the Tauri commands are only available inside the app window.

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run tauri dev` | Run the desktop app with hot reload |
| `npm run build` | Type-check and build the frontend bundle |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint over the frontend |
| `npm run format` | Prettier write |
| `npm test` | Frontend unit suite (Vitest) |
| `npm run test:watch` | The same suite, re-running on change |
| `npm run test:coverage` | Frontend suite with a coverage report |
| `npm run test:rust` | Rust suite for both crates |
| `npm run test:all` | Everything |

### Tests

574 unit tests run without a database or a window: 361 in Rust, 213 in the
frontend.

The Rust side covers every statement the app can build — the browse `SELECT`,
each filter operator, the row identity, `INSERT`, `UPDATE`, `DELETE` and all the
DDL — by asserting the SQL text and the bound parameters, so a change in quoting
or casting fails loudly. Around that sit the value decoders, the statement
splitter, the CSV/JSON/XLSX/SQL writers and readers, the dump scanner, the error
mapping and the on-disk storage, including its concurrent writes.

The frontend suite covers the formatters, the insert-form validation, the four
Zustand stores, the shortcut matcher, the IPC layer and the SQL statement
splitter the editor uses to decide what "Run" executes. Tauri's IPC is stubbed
in `tests/setup.ts`, so nothing there can reach a real window or a real server.

## Build

```bash
npm run tauri build
```

Artifacts land in `src-tauri/target/release/bundle/`:

- `deb/wishpostgres_1.0.2_amd64.deb`
- `rpm/wishpostgres-1.0.2-1.x86_64.rpm`
- `appimage/wishpostgres_1.0.2_amd64.AppImage`

The bare executable is `src-tauri/target/release/wishpostgres`.

## Releasing

Releases are built by GitHub Actions, never by hand, so what ships is exactly
what the tag contains.

```bash
# 1. Set the version in package.json, src-tauri/Cargo.toml and
#    src-tauri/tauri.conf.json, and write the entry in CHANGELOG.md.
# 2. Commit, tag and push.
git tag -a v1.1.0 -m "WishPostgres 1.1.0"
git push origin main --follow-tags
```

Pushing the tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml),
which type-checks, lints, runs the Rust tests, builds the three bundles plus a
tarball, writes `SHA256SUMS`, publishes the GitHub release with notes assembled
from `CHANGELOG.md`, and refreshes the APT repository on the `gh-pages` branch.

Signing the APT repository needs two repository secrets. Without them the
release still publishes; only the `apt` route needs a signature, and `apt`
refuses an unsigned repository.

```bash
# Once, to create a signing key:
gpg --quick-generate-key "WishPostgres <you@example.com>" rsa4096 sign never

# Then, to hand it to Actions. Base64 because pasting an armoured block into
# the secrets form loses its line breaks, and gpg then reports only
# "no valid OpenPGP data found":
key=$(gpg --list-secret-keys --with-colons | awk -F: '/^sec:/ {print $5; exit}')
gpg --export-secret-keys --armor "$key" | base64 -w0 |
  gh secret set APT_GPG_PRIVATE_KEY
gh secret set APT_GPG_PASSPHRASE      # paste the key's passphrase
```

| Secret | Value |
| --- | --- |
| `APT_GPG_PRIVATE_KEY` | The armoured private key, or base64 of it |
| `APT_GPG_PASSPHRASE` | Its passphrase, or empty if it has none |

The release workflow refuses to publish a repository it could not sign, so a
bad secret fails the run rather than shipping something `apt` will reject.

GitHub Pages must be set to serve from the `gh-pages` branch for the `apt` route
and the install script to be reachable.

## Folder structure

```
.
├── index.html                  Entry document with the pre-hydration loader
├── src/                        Frontend
│   ├── components/
│   │   ├── connections/        Connection list and status
│   │   ├── dialogs/            Every modal: connection, insert, import, export,
│   │   │                       backup, restore, settings, shortcuts, errors
│   │   ├── grid/               Virtualised data grid, editor, toolbar, filters
│   │   ├── layout/             Shell, top bar, sidebar, object tree, splash
│   │   ├── sql/                CodeMirror editor, results, history and saved
│   │   └── ui/                 shadcn-style primitives over Radix
│   ├── constants/              Static tables such as the shortcut map
│   ├── hooks/                  Catalog queries, scope sync, shortcuts, clipboard
│   ├── lib/                    Small shared helpers
│   ├── pages/                  Welcome, table, query, catalog and history pages
│   ├── services/               Typed wrappers around the Tauri commands
│   ├── state/                  Zustand stores: connection, workspace, settings
│   ├── styles/                 Tailwind theme and global CSS
│   ├── types/                  TypeScript mirrors of the Rust models
│   └── utils/                  Formatting, validation, notifications
└── src-tauri/                  Backend
    ├── core/                   `pgl-core`: pure Rust, no GUI dependency
    │   └── src/
    │       ├── backup.rs       pg_dump and psql drivers with progress
    │       ├── data.rs         Browse, insert, update, delete
    │       ├── ddl.rs          Structure changes
    │       ├── error.rs        SQLSTATE to cause and suggested fix
    │       ├── export.rs       CSV, JSON, XLSX and SQL writers
    │       ├── ident.rs        Identifier quoting and validation
    │       ├── import.rs       CSV, JSON and spreadsheet readers
    │       ├── introspect.rs   Catalog queries
    │       ├── models.rs       Serde types shared with the frontend
    │       ├── pool.rs         Per-connection pools and session management
    │       ├── query.rs        Statement splitting and execution
    │       ├── tls.rs          rustls connector
    │       └── value.rs        PostgreSQL binary values to JSON
    └── src/                    Tauri layer
        ├── commands/           Thin command handlers, grouped by concern
        ├── storage/            Settings, workspace, history, secrets
        ├── error.rs            Structured error reports across the IPC boundary
        └── state.rs            Shared application state
```

The split matters: `pgl-core` has no Tauri dependency, so the database layer
compiles and its tests run on their own, in seconds, without a display server.

## Technology stack

| Layer | Choice |
| --- | --- |
| Shell | Tauri 2 |
| Backend | Rust, `tokio`, `tokio-postgres`, `deadpool-postgres` |
| TLS | `rustls` with the ring provider — no OpenSSL headers needed |
| Credentials | `keyring` (Secret Service), XChaCha20-Poly1305 fallback |
| Frontend | React 18, TypeScript (strict), Vite 6 |
| Styling | Tailwind CSS 4 |
| Components | shadcn/ui patterns over Radix primitives |
| Tables | TanStack Table and TanStack Virtual |
| Server state | TanStack Query |
| Client state | Zustand |
| Forms | React Hook Form with Zod |
| Editor | CodeMirror 6 |
| Icons | Lucide |
| Toasts | Sonner |
| Spreadsheets | `calamine` for reading, `rust_xlsxwriter` for writing |

## Keyboard shortcuts

### General

| Shortcut | Action |
| --- | --- |
| `Ctrl` `N` | New connection |
| `Ctrl` `F` | Search in the current view |
| `Ctrl` `Shift` `F` | Global object search |
| `Ctrl` `K` | Global object search |
| `Ctrl` `R` | Refresh everything |
| `Ctrl` `,` | Settings |
| `?` | Shortcut reference |
| `Esc` | Close dialog |

### SQL editor

| Shortcut | Action |
| --- | --- |
| `Ctrl` `Enter` | Run selection, or the whole tab |
| `Ctrl` `Shift` `Enter` | Run every statement |
| `Ctrl` `L` | Clear the editor |
| `Ctrl` `T` | New tab |
| `Ctrl` `W` | Close tab |
| `Ctrl` `F` | Find in editor |

### Data grid

| Shortcut | Action |
| --- | --- |
| `←` `↑` `↓` `→` | Move between cells |
| `PgUp` `PgDn` | Jump a page |
| `Enter` | Edit the active cell |
| `Esc` | Cancel editing |
| `Space` | Toggle row selection |
| `Shift` `Click` | Extend the selection |
| `Ctrl` `A` | Select every row |
| `Ctrl` `C` | Copy cell or selection |
| `Delete` | Delete selected rows |
| `F2` | Rename the selected object |

## Security

- **No string concatenation of values.** Every user-supplied value is a bound
  parameter with an explicit `::type` cast taken from the catalog.
- **Identifiers are quoted, never interpolated raw.** Table, schema and column
  names go through `quote_ident`, which escapes embedded quotes and rejects
  empty or oversized names. Sort direction is an enum, not a string.
- **Type and expression expressions are validated.** The few places PostgreSQL
  forbids a parameter — a column `DEFAULT`, an `ALTER … USING` clause — accept a
  restricted character set and reject statement terminators and comment markers.
- **Filter patterns are escaped.** `%` and `_` in a user's search text are
  escaped so they match literally.
- **Credentials never touch the command line.** `pg_dump` and `psql` receive the
  password through the environment, so it never appears in the process list.
- **Destructive actions are gated.** Dropping or truncating requires typing the
  object's name; large deletes require a typed confirmation.

### Where passwords are stored

WishPostgres asks the OS keyring first, through the Secret Service API — that is
GNOME Keyring, KWallet, or anything else implementing the spec. This is the
normal path and the one Settings will report.

When no keyring can be reached — a headless session, or a desktop with no Secret
Service provider — it falls back to `credentials.enc` in the config directory.
That file is encrypted with XChaCha20-Poly1305 under a key derived from the
machine id and a random per-installation salt, and is written with `0600`
permissions. **This protects against casual disclosure such as a backup or a
synced dotfile directory; it does not protect against an attacker who already
has read access as your user.** Settings shows which backend is in use so you
are never guessing.

Configuration lives in `~/.config/dev.wishpostgres.app/`.

## Notes and limits

- PostgreSQL 12 or newer is required, because the structure page reads
  `attgenerated` from the catalog.
- Result sets are capped at 200,000 rows per statement so one runaway query
  cannot exhaust memory; the result panel says so when a cap is hit.
- Row counts above 500,000 use the planner estimate instead of `count(*)`, which
  keeps browsing instant. Applying a filter switches back to an exact count.
- Backup and restore need `pg_dump` and `psql` on `PATH`, or a directory set in
  Settings. Their presence and versions are shown there.
- Values of exotic types without a dedicated decoder fall back to their UTF-8
  rendering, or a `\x…` hex escape when they are not text — the same convention
  `psql` uses.

## License

MIT. See [LICENSE](LICENSE).
