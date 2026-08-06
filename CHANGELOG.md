# Changelog

All notable changes to WishPostgres are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.1]: https://github.com/wishdevsuz/wish-pgAdmin/releases/tag/v1.0.1
[1.0.0]: https://github.com/wishdevsuz/wish-pgAdmin/releases/tag/v1.0.0
