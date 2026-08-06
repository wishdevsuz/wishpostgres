# Changelog

All notable changes to WishPostgres are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/wishdevsuz/wish-pgAdmin/releases/tag/v1.0.0
