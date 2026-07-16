# Security Policy

## Reporting a Vulnerability

Please report security issues **privately** through GitHub's private vulnerability
reporting:

**https://github.com/KunalDSoni/Atlas/security/advisories/new**

Please do **not** open a public issue, pull request, or discussion for a security bug —
that discloses it to everyone before a fix exists.

When reporting, include as much of the following as you have:

- What the issue is and why it matters (what an attacker gains)
- Steps to reproduce, ideally a `curl` command or short script
- The affected endpoint, file, or component
- Any suggested remediation

**What to expect:** an initial acknowledgement within 5 business days, an assessment
with a severity rating and a fix timeline, and credit in the release notes when the fix
ships (unless you would rather stay anonymous). Please give us a reasonable window to
ship a fix before disclosing publicly.

## Supported Versions

Atlas ships from `main`. Security fixes are applied to the latest release only; there
are no maintained backport branches. Run the latest version.

## Security Model

Understanding these three rules explains most of the codebase's security decisions.

### 1. Identity comes only from the session token

`POST /api/auth/login` returns a session token. Every authenticated request must send it:

```
x-auth-token: <session token>
```

The server resolves the user id **and role** by looking that token up in the `sessions`
table. Identity is never read from client-supplied input.

> **`x-user-id` and `x-user-role` are ignored.** Older builds fell back to trusting these
> headers when no valid session existed, which let anyone become an admin by sending
> `x-user-role: admin`. That fallback has been removed. Clients may still send these
> headers — they have no effect on access control.

### 2. Passwords are only ever stored hashed

Passwords are hashed with **scrypt** (`N=16384, r=8, p=1`, 64-byte key, 16-byte random
salt) using Node's built-in `crypto` — no external dependency. The stored format is:

```
scrypt$16384$8$1$<saltHex>$<keyHex>
```

Every credential is individually salted, and verification is constant-time. Plaintext
passwords are never written, logged, or returned by the API.

Legacy plaintext credentials are upgraded transparently on the next successful login. To
convert every account at once, see [Migrating an existing deployment](#migrating-an-existing-deployment).

### 3. Roles are enforced server-side

Four roles — `admin`, `board_admin`, `user`, `client` — are enforced by
`requireAuth` / `requireAdmin` / `requireRole` in `backend/middleware/auth.js`, using the
role from the session. The frontend hides controls a user cannot use, but that is a UX
affordance and **not** a security boundary.

### User-authored HTML

Wiki pages and wiki comments are stored as HTML written by users and rendered into other
users' browsers. Unsanitised, any author could run script on the app's origin and read
every viewer's session token.

Bodies are sanitised **on write** (`backend/utils/sanitize.js`) so what is stored is
already safe, and sanitised **again on render** (`frontend/src/components/app/rich-text.tsx`)
as defence in depth — which also covers rows written before that fix. `<script>`, inline
event handlers (`onerror=`), `javascript:` URLs, and script inside inline styles are all
stripped; headings, lists, tables, links, and formatting survive, and external links get
`rel="noopener noreferrer"`.

Never render a wiki body with a bare `dangerouslySetInnerHTML` — use `RichTextView`.

### File access

Browsers cannot attach an `x-auth-token` header to `<img src>`, `<video src>`, or an
`<a href>` download. Rather than leaving file routes public, attachment URLs are
authorised by a short-lived **HMAC signature** (keyed on `SESSION_SECRET`, bound to the
attachment id, 1-hour expiry). The API returns ready-made `preview_url` and
`download_url` fields; a request with no signature and no session is rejected.

Uploaded files are stored under a generated UUID filename, never the user-supplied one.
Only images, PDFs, and video render inline — everything else (notably **SVG**, which can
execute script) is forced to download, and previews are served with
`Content-Security-Policy: default-src 'none'; sandbox` and `X-Content-Type-Options: nosniff`.

## Deployment Hardening

Atlas is not safe on a public network with default settings. Before exposing it:

| # | Action | Why |
|---|--------|-----|
| 1 | **Set a strong random `SESSION_SECRET`** (`openssl rand -hex 32`) | Signs attachment URLs. The default is public knowledge, and a known secret lets anyone forge file access. |
| 2 | **Change `ADMIN_PASSWORD`** from `changeme123` | It is the documented default. |
| 3 | **Set `SEED_DEMO_DATA=false`** | Demo seeding creates five accounts that all share the published password `password123`. |
| 4 | **Never reuse the demo database in production** | Demo accounts are well-known and world-readable in this repo. |
| 5 | **Terminate TLS** in front of the app (reverse proxy) | Session tokens travel in a header; over plain HTTP they are sniffable. |
| 6 | **Set `CORS_ORIGINS`** to your exact origin(s), or leave unset | Unset means same-origin only, which is correct when the SPA is served by this server. Never use `*`. |
| 7 | **Do not expose MySQL's port** publicly | `docker-compose.yml` maps `3306:3306` for convenience; remove that mapping in production. |
| 8 | **Set `NODE_ENV=production`** | Suppresses error detail in API responses and enables HSTS. |
| 9 | **Keep `.env` out of git** | Already in `.gitignore` — keep it that way. |
| 10 | **Run `npm audit`** regularly | See [Dependencies](#dependencies). |

### Secrets

Real secrets belong in `.env`, which is git-ignored and has never been committed to this
repository. `.env.example` contains **placeholders only** — never paste a working
credential into it. If a secret is ever committed, rotate it: scrubbing git history does
not un-leak a value that was pushed.

## Built-in Protections

- **SQL injection** — every query is parameterised. Dynamic `UPDATE` statements build
  their column list from hardcoded whitelists, never from request keys.
- **Brute force** — login is rate limited to 10 attempts per 15 minutes per IP+email,
  returning `429` with `Retry-After`. The counter resets on success. This limiter is
  in-memory: behind multiple instances, move it to a shared store.
- **Session invalidation** — changing a password deletes the user's other sessions.
- **Error disclosure** — with `NODE_ENV=production`, exceptions are logged server-side and
  the API returns a generic message instead of raw SQL/filesystem text.
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`, plus HSTS in
  production.
- **Request size** — JSON bodies are capped at 1 MB; uploads at 50 MB across 10 files.

## Migrating an Existing Deployment

A database created before password hashing still holds plaintext passwords. Logging in
re-hashes an account automatically, but that only covers users who actually log in. To
convert every account at once:

```bash
cd backend
node scripts/hash-passwords.js          # dry run — reports what would change
node scripts/hash-passwords.js --apply  # rewrite them
```

Existing passwords keep working; only their storage changes. The script is idempotent and
safe to re-run.

**If your deployment ever ran a build that trusted `x-user-id` / `x-user-role`, treat it
as compromised:** any unauthenticated party could have read or modified all data. Rotate
`SESSION_SECRET`, force a password reset for all users, and review
`/api/admin/audit-log`. Note that the audit log attributes actions to the *claimed*
identity, so entries from that period cannot be trusted.

## Known Limitations

Deliberate trade-offs you should know about:

- **Rate limiting is per-process and in-memory.** It resets on restart and does not
  coordinate across replicas.
- **Only login is rate limited.** Other endpoints are not.
- **No CSRF tokens.** Authentication is via a custom header rather than cookies, so a
  cross-site form post cannot authenticate. This stops holding if you move to cookies.
- **No password complexity rules** beyond a 6-character minimum, and no account lockout,
  MFA, or password reset flow.
- **No per-project authorisation on some read paths.** Any authenticated user can read the
  user directory and, in places, data across projects. Roles gate writes more tightly
  than reads.
- **Attachment signatures are bearer capabilities.** Anyone holding a signed URL can fetch
  that file until it expires (1 hour).
- **Session tokens are stored in browser `localStorage`**, so any XSS on the app origin
  can steal them.
- **`atlas.html`** is a self-contained demo with in-memory data and no server-side
  authorisation. It is a UI prototype — do not deploy it as a real application.
- **Wiki HTML is sanitised, not escaped.** Formatting tags are allowed by design, so the
  sanitiser's allow-list is the security boundary. Widen it carefully.

## Dependencies

```bash
cd backend && npm audit
```

Fix anything reported before shipping. The backend deliberately keeps a small dependency
surface, and hashing and signing use Node's built-in `crypto` rather than third-party
packages.

## Reporting Scope

**In scope:** authentication and session handling, authorisation and role enforcement,
injection, secret exposure, file upload/download handling, and the API surface under
`backend/routes/`.

**Out of scope:** the default demo credentials (documented above and intentional for
demos), issues that require an already-compromised admin account, missing hardening on
`atlas.html` (a prototype, as noted), and vulnerabilities in unmodified upstream
dependencies — report those upstream, though we do want to hear if we ship a vulnerable
version.
