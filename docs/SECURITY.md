# Security

## Authentication

- Only employees HR has added (and left active) can sign in. Switching someone off blocks them immediately, including existing sessions.
- Two methods: a **6-digit email code** (expires in 10 minutes, 5 attempts, 60-second resend gap, stored hashed) or a **password** (min 10 characters with letters and numbers, bcrypt cost 11).
- Passwords: 5 wrong attempts lock password sign-in for 10 minutes (the email code still works).
- The sign-in screens answer the same way whether or not an email is on the list, so the list cannot be probed.
- Sessions are signed JWTs in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production), valid 12 hours. Signing out clears it.
- Sign-in endpoints are rate limited.

## Authorization

- Server-side role check on every `/api/admin` route. Employees cannot reach admin APIs by guessing URLs.
- Eligibility (active + participating region) is enforced on the entries, ballot, save and vote endpoints and on entry files, not only in the screens.
- Entry files: HR any time; participating employees only while voting is open; anyone once results are published.

## Vote integrity and privacy

- One ballot per person: database primary key on (contest, user), inside the vote transaction.
- Votes have no user id. HR can see who voted, never what they voted for.
- Drafts are separate, never counted and deleted at close.
- Hard close enforced on every request against the server clock.
- The voter's own receipt is AES-256-GCM encrypted with a per-user key derived from `APP_SECRET`. Keep that secret out of the repository and rotate it only with a plan, because rotating it makes existing receipts unreadable (votes and results are unaffected).
- No live scores for voters: the leaderboard exists only under `/api/admin`.
- Every admin action is written to an append-only activity log (no edit or delete endpoint).

## File handling

- Allow-list of extensions per entry type, validated by content (images are decoded, PDFs and Word files are parsed), size limit 100 MB, up to 100 files per bulk upload.
- Metadata removal: images are re-encoded (EXIF, GPS, camera and author fields are dropped); PDFs have author, title, creator and XMP removed; Word files have creator, last editor, company and tracked-change authors blanked; videos are stripped when `ffmpeg` is installed.
- Files are stored under random names, served with `nosniff`, as `Entry NN.ext`, and only through authenticated endpoints.
- Word documents are shown as converted HTML after a script/attribute sanitiser; PDFs are rendered to canvas.

## Web hardening

- `helmet` with a Content Security Policy (scripts from self only), no inline scripts.
- JSON body limit, strict input validation with Zod, parameterised queries through Knex (no string-built SQL).
- Email preview and outbox pages render in sandboxed iframes.
- Errors do not leak internals; unexpected failures return a generic message and log on the server.

## Operations checklist for production

1. Set a long random `APP_SECRET`. The server refuses to start in production with a default one.
2. Change the bootstrap admin password on first sign-in; remove `BOOTSTRAP_ADMIN_PASSWORD` from the environment afterwards.
3. Use PostgreSQL, HTTPS and a persistent volume (or object storage) for uploads.
4. Configure SMTP with SPF/DKIM for the sender domain.
5. Back up the database and the upload folder together.
6. Restrict who is an HR admin; review the activity log regularly.
7. Keep Node and dependencies updated (`npm audit`).

## Known limits

- Login is email code or password; Microsoft 365 single sign-on is not included in version 1.
- Receipts are decryptable by someone who holds both the database and the server secret.
- Video metadata is only removed when `ffmpeg` is available on the server.
- The PostgreSQL path is implemented but has been exercised mainly on SQLite.
