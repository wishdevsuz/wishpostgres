# Changelog

All notable changes to WishPostgres are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.2]

A polish release. Everything the interface offers now does something, the
keyboard shortcuts the app documents are all bound, and the settings that had no
effect have one.

### Added

- **A test suite that runs without a database or a window: 574 unit tests**, 361
  in Rust and 213 in the frontend, up from 48. Every statement the app can build
  is asserted as SQL text and bound parameters — the browse `SELECT`, each filter
  operator, the row identity, `INSERT`, `UPDATE`, `DELETE` and all the DDL — so a
  regression in quoting or casting fails the build rather than the user's
  database. Around that sit the value decoders, the statement splitter, the
  CSV/JSON/XLSX/SQL writers and readers, the dump scanner, the error mapping, the
  on-disk storage including its concurrent writes, the four stores, the shortcut
  matcher and the IPC layer. `npm test`, `npm run test:rust` and `npm run
  test:all` run them; the frontend suite is now part of CI too.
- **The window draws its own title bar.** The system title bar was a second,
  empty strip above the app's own toolbar. It is gone, and the toolbar is now
  the title bar: drag it to move the window, double click it to maximise, and
  the minimise, maximise/restore and close buttons sit at its right end. The
  window edges and corners resize as before.
- **Extensions can be installed, updated and removed.** The Extensions page
  listed what was available but had no way to act on it. Each row now has an
  **Install** button, an **Update** button when the installed version is behind
  the default, and a remove action that asks first.
- **Rename a table or view.** `ALTER … RENAME` was implemented in the backend
  but nothing reached it. It is now on the object tree's context menu, in the
  table page's menu, and on **F2** — the shortcut the app already documented.
- **Truncate and drop from the object tree.** The tree's "Drop or truncate…"
  entry only opened the Structure tab. It now runs the statement, after typed
  confirmation, with an optional **CASCADE** for drops.
- **EXPLAIN ANALYZE.** The backend accepted an `analyze` flag — running the
  statement inside a transaction it always rolls back — that the button never
  set. Explain is now a menu with both the plan and the analysed run.
- **Save a query with Ctrl+S**, the shortcut the dialog listed but nothing
  handled. Tabs can also be renamed, from the toolbar or by double clicking the
  tab.
- **Show and hide the sidebar** with **Ctrl+B** or the button in the title bar.
- **Exact row counts on demand.** Large tables show the planner's estimate;
  clicking it now runs a real `count(*)` instead of leaving `~` with no way past
  it.
- Query in a new SQL tab, copy the qualified name and reload from the object
  tree, the table page and the functions list; first-page and per-section
  reload buttons in the grid and the tree; copy SQL and a favourite toggle for
  saved queries, which now sort favourites first.
- Deleting a connection, clearing the history, deleting a saved query and
  resetting the settings all confirm first.

### Fixed

- **Editing data failed on every column that was not text.** Values are sent to
  PostgreSQL as text and the statement cast them with `$1::integer`, which makes
  the server infer an *integer parameter* — the driver then refuses to send a
  string for it and the whole statement dies with "error serializing parameter
  0". So inserting a row, editing a cell, deleting selected rows and filtering
  all failed on any table with a numeric, date, uuid or boolean key or column,
  which is nearly all of them. Every value now casts through `text` first, which
  pins the parameter and leaves the conversion to PostgreSQL's own input
  function.
- **Ticking a row's checkbox left the keyboard focus outside the grid**, so
  Delete and Ctrl+C did nothing until a cell was clicked as well.
- **`?` never opened the shortcuts dialog.** The key requires Shift on most
  layouts, and the matcher insisted Shift not be held. An unspecified Shift now
  means "either", and the shortcuts that need the distinction say so.
- **Ctrl+T opened two SQL tabs** while the query page was showing, because the
  page and the app shell both bound it on `window` and `stopPropagation` does
  not stop a second listener on the same target.
- **Ctrl+F did nothing outside the SQL editor** although it was listed as
  "search in the current view". It now focuses the filter box of whichever view
  is open.
- **Delete did not delete the selected rows** in the grid, and Escape did not
  clear a selection. Both are bound now.
- **The "Interface size" setting had no effect.** It set a CSS variable nothing
  read; the interface is authored in absolute pixels, so it now scales the
  document instead.
- **Importing with a Tab delimiter split on a backslash.** `"\t"` in JSX is a
  literal backslash followed by `t`, and the reader takes the first byte. A
  `.tsv` file also selects the tab delimiter on its own now.
- **Import could map a generated column**, which PostgreSQL always rejects.
  Generated columns are excluded from the automatic mapping, matching the list
  that is actually shown, and re-opening the dialog no longer inherits the
  previous file's mapping.
- **Typing in a SQL tab could lose its undo history and cursor.** The editor was
  rebuilt from scratch whenever the completion schema finished loading; the
  schema is now swapped in place.
- **"Run" and "Run all" did the same thing.** Run now executes the selection, or
  the statement the cursor is in, splitting on semicolons outside strings,
  comments and dollar-quoted bodies.
- **Changing "rows per page" in Settings did not reach an open table.** It does,
  until the page size is changed on the table itself.
- **A table left the grid on an empty page** after deleting the last rows on it,
  with no indication why. It steps back a page.
- Editing a cell, then losing rows underneath it, left the focus ring and the
  editor pointing at a row that no longer existed.
- Results kept the previous run's page and row selection, so an export could
  write rows the user never picked.
- **Disconnect reported success even when it failed**, and left the previous
  database's data in the cache.
- A failed drag of the sidebar edge could leave the resize cursor stuck over the
  whole window.
- The row range read `1–0` on an empty page, and the page-size menu did not show
  which size was selected.
- Backup, restore, structure edits and DDL no longer refetch every query in the
  app — only the caches that can have changed — so the tree stops flickering
  after each statement.
- App shortcuts no longer fire behind an open dialog.
- A corrupt settings or connections file no longer leaves the window on the
  splash screen; the failure is reported and the app starts on its defaults.
- The export dialog no longer offers to write an empty file, states exactly
  which rows it will write, and follows the table it was opened from.
- A tab holding nothing but comments is no longer sent to the server, where it
  produced an empty response with no explanation; running one now says there is
  nothing to run.
- Removed the add-column dialog that was mounted at the app root with nothing
  able to open it, along with the dialog states nothing used.

### Internal

- The statement builders are separated from the code that executes them, so each
  one can be asserted directly. `ddl` gained `add_column_sql`, `alter_column_sql`,
  `rename_relation_sql`, `truncate_table_sql`, `drop_relation_sql` and
  `extension_sql`; `data` gained `build_select`, `build_insert`, `build_update`
  and `build_delete`. The four extension commands collapsed into one
  `set_extension` taking a typed `ExtensionAction`.

### Changed

- **The repository moved to `wishdevsuz/wishpostgres`.** GitHub redirects the
  old repository URLs, so clones, issues and release links keep working. The
  GitHub Pages address is not redirected, so anyone who added the APT
  repository before the move has to point it at the new host:

  ```bash
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/wishpostgres.gpg] https://wishdevsuz.github.io/wishpostgres/apt stable main" \
    | sudo tee /etc/apt/sources.list.d/wishpostgres.list > /dev/null
  sudo apt update
  ```

  The install one-liner is now
  `curl -fsSL https://wishdevsuz.github.io/wishpostgres/install.sh | bash`.

## [1.0.1]

### Security

- **A restored dump could run shell commands.** Restore streams a `.sql` file
  into `psql`, and `psql` executes the backslash meta-commands it finds there —
  so a dump from an untrusted source could run anything with `\!`, read any
  readable file with `\i`, or write one with `\o`. None of that reaches the
  database, so nothing in the SQL layer would have stopped it. Dumps are now
  scanned before they are streamed and refused if such a command appears at the
  start of a line, naming what was found. COPY blocks are skipped so row data
  containing a backslash is not mistaken for a command, and `\.` and `\connect`
  — the only two `pg_dump` emits — stay allowed. A file that genuinely needs
  meta-commands can still be restored with the new **Allow psql meta-commands**
  checkbox, which is per file and never remembered.

### Fixed — installer

- **Installing failed from behind a shared address.** Finding the latest version
  went through the GitHub API, which allows 60 unauthenticated requests an hour
  per address — quickly exhausted on an office NAT, a university network or CI,
  and the install then died with "could not work out the latest version". The
  `/releases/latest` redirect is followed instead, which needs no API call and
  has no such limit. The API remains as a fallback.
- **A system without `sha256sum` was told its download was corrupt.** The
  missing tool produced an empty hash, which failed the comparison and was
  reported as a checksum mismatch. `shasum` and `openssl` are now tried in turn,
  and a genuine absence says so rather than accusing the file.
- Filenames went into a `grep` pattern unescaped, so their dots matched any
  character; checksum mismatches now also print both hashes.
- **The AppImage route left the launcher entry without an icon.** The icon
  theme is now copied out of the AppImage, so every size lands where it belongs
  — the same layout the `.deb` installs — and the entry gained the generic name,
  keywords and `StartupWMClass` the packaged one has.
- `apt-get` runs with `DEBIAN_FRONTEND=noninteractive`, since this is usually
  reached through `curl | bash` where a prompt has no stdin to read from.
- Output is only coloured when stdout is a terminal, so redirecting the
  installer into a log no longer fills it with escape sequences.

### Fixed — APT repository

These only went wrong on the *second* release, so 1.0.0 did not show them:

- The cloned `gh-pages` working copy kept its own `.git`, which would have been
  published along with everything else — carrying the push token with it.
- Last release's `Release.gpg` and `InRelease` were still on disk while the new
  `Release` was generated, so they were hashed into it and `apt` would have been
  checking a stale signature against fresh metadata.
- The `Release` file listed itself, because the redirect creating it ran before
  the scan that reads the directory.
- Publishing no longer merges with whatever was already on the branch, so what
  is served is exactly what was built.
- The workflow now verifies its own signature before publishing, and says so
  loudly when no signing key is configured, rather than quietly shipping a
  repository `apt` will refuse.
- `SHA256SUMS` names its four files explicitly instead of globbing, so it can
  never end up listing itself.

## [1.0.0]

First public release.

### Correctness

- **Inline edits could touch more rows than the one selected.** A column that
  was part of a *composite* `UNIQUE(a, b)` was recorded as unique on its own, so
  a table with no primary key could pick a non-unique column as its row
  identity. An edit or a delete then matched every row sharing that value. Only
  a unique constraint whose key is a single column is now treated as an
  identity.
- **`jsonb` values that were bare scalars came back as hex.** `jsonb` arrives as
  a version byte followed by JSON text, and the header was only stripped when
  the next byte was not a quote — which is exactly the case for a JSON string.
  `'"hello"'::jsonb` rendered as `\x01...`. The header is now stripped first and
  the raw bytes are the fallback.
- **`EXPLAIN ANALYZE` really ran the statement.** Asking for an analysed plan of
  a `DELETE` or `UPDATE` executed it. Analysed plans are now taken inside a
  transaction that is always rolled back, so the plan and the real timings
  survive but the writes do not.
- **`VACUUM`, `CREATE DATABASE` and friends could not be run at all.** They were
  sent over the extended query protocol, which wraps every statement in an
  implicit transaction these commands refuse to run inside. They now go over the
  simple query protocol, the way `psql` sends them.
- **Wide imports failed outright.** A file with more than about 130 mapped
  columns exceeded PostgreSQL's limit of 65,535 bind parameters per statement.
  The batch size is now derived from the column count.
- **`bigint` values of exactly `-9223372036854775808` overflowed** while being
  classified as JavaScript-safe or not.
- **IPv6 addresses were rendered uncompressed** — `2001:db8:0:0:0:0:0:1` instead
  of `2001:db8::1`.

### Security

- **Dollar quoting could hide a second statement** from the validator that
  guards column `DEFAULT` and `ALTER … USING` expressions. A `'` inside a
  `$$…$$` quote desynchronised the scanner, so a following `;` looked like
  string content. The validator now understands dollar quoting.
- **String literals are now escape strings when they contain a backslash**, so
  they mean the same thing whether or not the server has
  `standard_conforming_strings` enabled, and null bytes are dropped rather than
  being allowed to truncate a statement.
- **The credential vault is created `0600`** rather than written and then
  chmod-ed, closing the window in which the encrypted file was world readable.

### Reliability

- Concurrent writes to settings, workspace, history and saved queries no longer
  lose one another. Each read-modify-write now holds a lock for its duration.
- The same applies to the credential vault: two connections saved at once can no
  longer drop one another's password.
- A read failure while streaming a backup or restore no longer abandons the
  `pg_dump` or `psql` child process unreaped.
- The connect timeout is no longer taken from the *query* timeout setting. A
  long-running query allowance no longer means an unreachable host takes minutes
  to report.

### Packaging

- `.deb`, `.rpm`, AppImage and a plain tarball, built and published by GitHub
  Actions from a tag, with `SHA256SUMS` for every file.
- An APT repository on GitHub Pages, so `apt install wishpostgres` works and
  updates arrive with `apt upgrade`.
- A one-line installer that detects the distribution, verifies the checksum and
  installs the right package.

[1.0.2]: https://github.com/wishdevsuz/wishpostgres/releases/tag/v1.0.2
[1.0.1]: https://github.com/wishdevsuz/wishpostgres/releases/tag/v1.0.1
[1.0.0]: https://github.com/wishdevsuz/wishpostgres/releases/tag/v1.0.0
