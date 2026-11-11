# Architecture and tech stack

## Tech stack

| Layer | Technology |
| --- | --- |
| Web app | React 19, TypeScript, Vite, React Router, TanStack Query, lucide-react icons, pdf.js (PDF viewer) |
| Styling | Hand-written CSS design system (CSS variables, light/dark/system themes), Poppins font |
| API | Node.js 20+ (built on 24), Express 5 |
| Validation | Zod |
| Database | SQLite (better-sqlite3) for local and small deployments; PostgreSQL for production. Both through Knex migrations |
| Auth | Email one-time code **or** password (bcrypt); JWT in an httpOnly cookie |
| Files | Local disk (`UPLOAD_DIR`); processing with sharp (images), pdf-lib (PDF), JSZip (Word), mammoth (Word to HTML); optional ffmpeg for video |
| Email | Nodemailer (SMTP, Azure Communication Services in production) or a built-in dev mailbox, through a database-backed queue |
| Excel | ExcelJS (import and export) |
| Tests | Node's built-in test runner, end to end over HTTP |

## Repository layout

```
server/
  src/index.js            app bootstrap, security headers, routes, scheduler
  src/config.js           environment configuration
  src/db/                 Knex connection, migrations, bootstrap, demo seeds
  src/lib/                auth, scoring, mail, files, contests, audit, util
  src/routes/             auth, portal (employees), files, adminContests, adminUsers, adminReports
  test/                   end-to-end rules test, upload metadata tests
web/
  src/App.tsx             shell, header, routing
  src/pages/              Login, Home, Vote, Results, admin/*
  src/components/         UI kit, entry viewer, PDF pages, page backdrop
docs/                     this documentation
```

## System diagram

```
 Browser (React SPA)
    |  HTTPS, JSON + file uploads, httpOnly session cookie
    v
 Express API  ------------------------------+
  |  auth / portal / files / admin          |
  |                                         |
  |  Scheduler (5 s): close contests whose end time has passed
  |  Mail worker (2 s): send queued emails, retry up to 3 times
  v                                         v
 SQLite or PostgreSQL                 Local disk (uploads)      SMTP server
```

One Node process serves the API and, in production, the built web app (`web/dist`).

## Data model

| Table | Purpose |
| --- | --- |
| `regions` | Region code, name, time zone, switched on/off |
| `users` | Name, email, team, **region (required)**, role, active, password hash, lockout fields |
| `otp_codes` | Hashed one-time sign-in codes with expiry and attempt count |
| `contests` | Name, theme, rules, entry types, regions, `is_global`, places, status, end time, banner |
| `entries` | Entry number (permanent), type, title, description, alt text, stored file keys, **competitor name** |
| `voter_status` | One row per (contest, user) who has voted. Holds **no entry information in the clear** and an encrypted receipt |
| `votes` | (contest, entry, rank, points). **No user reference** |
| `ballot_drafts` | Saved-for-later picks, deleted on submit and at close |
| `email_templates` | Per-contest wording overrides |
| `outbox` | Every email: queued, sent/captured, failed, cancelled |
| `app_settings` | HR switches (email notifications, email sign-in codes), key and on/off value |
| `audit_log` | Who did what and when |

## How voting works (server side)

1. **Eligibility:** the user is active and their region participates in the contest (global contests cover the regions that are switched on).
2. **Draft:** `PUT /ballot` stores picks in `ballot_drafts` while the contest is live.
3. **Submit:** `POST /vote` runs one transaction that inserts `voter_status` (primary key on contest and user, so a second ballot is impossible even with simultaneous requests), inserts the `votes` rows with no user id, deletes the draft, then queues the confirmation email.
4. **Close:** every save and submit checks the server clock against the end time, and a scheduler marks the contest closed and discards drafts.
5. **Results:** points are summed per entry, ordered by points, 1st-place picks, 2nd-place picks. Equal entries share a place.

## Anonymity design

- The employee entry API has no competitor field at all. Names are only in admin and published-results responses.
- Entry files are served as `Entry NN.ext`. Stored names are random UUIDs.
- Uploads are re-encoded or rewritten to remove metadata (see Security).
- `votes` has no user column, and `voter_status` has no entry column. Linking them is not possible from the database alone.
- A voter's own picks are stored as an **encrypted receipt** (AES-256-GCM, key derived per user from the server secret) so they can see "my vote". Only that voter's own session can read it through the API. A person with both the database and the server secret could decrypt receipts, so protect the secret like a password.

## Email

All emails go through the `outbox` table. A worker claims queued rows, sends them, and marks `sent`, or after 3 failures `failed`. This keeps a full-company send off the request path and survives restarts. `MAIL_TRANSPORT=dev` captures instead of sending, which is how the portal runs without SMTP. HR can also switch email off in **Admin > Settings**: `queue()` checks the `app_settings` flags and skips sign-in codes or notifications accordingly, and the sign-in page hides the email-code option.

## Scaling notes

- Reads are indexed; a vote is one short transaction.
- Use PostgreSQL if you need more than one API instance (SQLite must stay on a single instance). For up to about 250 employees one instance is plenty. The close job and the mail worker are idempotent, so running them on every instance is safe.
- Uploads are on local disk. For several instances use shared storage, or replace `lib/files.js` with S3 or Azure Blob.

## Deployment

```bash
npm run setup
npm run build            # builds web/dist
# set server/.env: APP_SECRET, DATABASE_URL, MAIL_TRANSPORT=smtp + SMTP_*, APP_URL, NODE_ENV=production
npm start                # API + built web app on PORT
```

Put it behind HTTPS (a reverse proxy or load balancer). `trust proxy` is enabled so secure cookies and rate limits work behind one proxy.

## Configuration (server/.env)

| Variable | Meaning |
| --- | --- |
| `PORT`, `APP_URL`, `NODE_ENV` | Server port, public URL used in email links, environment |
| `APP_SECRET` | Signs sessions and derives receipt keys. **Required and random in production** |
| `DATABASE_URL` | Empty for SQLite; `postgres://...` for PostgreSQL |
| `SQLITE_JOURNAL`, `BACKUP_HOURS`, `BACKUP_KEEP` | SQLite only: `wal` (default) or `delete` (use on Azure network storage), backup interval (6) and number kept (40) |
| `UPLOAD_DIR` | Where uploaded files live |
| `MAIL_TRANSPORT`, `MAIL_FROM`, `SMTP_*` | `dev` or `smtp` |
| `BOOTSTRAP_ADMIN_*` | First HR admin, created if no admin exists |

## Testing

`npm test` boots the real server on a throwaway database and drives it over HTTP. It checks: contests start only when ready, region visibility versus voting, names never reach voters, drafts, one vote per person including parallel submits, hard close, scoring and tie-breaks, publishing, email counts, the absence of any user link on votes, the audit trail, and metadata removal on photos, PDFs and Word files.
