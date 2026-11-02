# Lumovy Employee Choice Awards

One reusable voting portal for every Lumovy HR contest. HR sets up a contest (photos, writing, posters, documents or video), employees vote anonymously for their top 3, and HR publishes the winners on the portal and by email.

**Fair by design:** voters never see who made an entry, each person votes once, nobody (HR included) can see who voted for what, and every admin action is logged.

## Documentation

| Document | What is in it |
| --- | --- |
| [Product overview](docs/PRODUCT.md) | What it is, who uses it, what it does, lifecycle, fairness and scoring rules |
| [Architecture and tech stack](docs/ARCHITECTURE.md) | Stack, repository layout, data model, how voting works, deployment, configuration, testing |
| [Deployment on Azure](docs/DEPLOYMENT.md) | App Service + PostgreSQL, manual zip deploy, step by step, operations, rollback, cost |
| [Security](docs/SECURITY.md) | Authentication, authorization, vote privacy, file handling, hardening, production checklist |
| [User guide](docs/USER-GUIDE.md) | Full guide for employees and HR admins, plus troubleshooting |

## Quick start

Requires Node 20+ (built and tested on Node 24).

```bash
npm run setup                          # install server and web dependencies (once)
npm run seed:demo                      # optional demo data: employees, a past contest, a live contest, a draft
npm --prefix server run seed:more      # optional: more contests (several open, closed, published, coming soon, regional/global)
npm run dev:server                     # API on http://localhost:4000
npm run dev:web                        # app on http://localhost:5173
```

Open http://localhost:5173.

| Who | Sign in (demo only) |
| --- | --- |
| HR admin | `hr@lumovy.com` / `ChangeMe!123` (set `BOOTSTRAP_ADMIN_*` in `server/.env`; change it after first sign-in) |
| Employee | `asha.rao@lumovy.com` / `Employee!1234`, or any demo employee by **email code** |

In test mode (`MAIL_TRANSPORT=dev`) no real email is sent: the login screen shows the 6-digit code and every email is viewable in **Admin > Email outbox**. Copy `server/.env.example` to `server/.env` first.

Production: deployed to Azure App Service with a manual zip deploy. See [Deployment on Azure](docs/DEPLOYMENT.md).

Tests: `npm test`.

## Highlights

- **Employee portal:** email-code or password sign-in, contest home with a sliding banner of open contests and live countdown, anonymous voting with built-in viewers for images, PDF, Word, video and writing, save for later, review and submit, results with "Your vote", light/dark themes, mobile-first.
- **HR admin:** step-by-step contest setup, copy a contest, single and bulk entry upload, employee preview, Start contest with a readiness checklist, extend deadline, close early, live tracking and reminders, results review and publish, editable email templates, Excel import and export, activity log.
- **Regions:** every user belongs to one region; contests are Regional, Selected regions or Global. Everyone can see every contest, only participating regions can vote.

## Repository

```
server/   Node + Express 5 API, Knex, SQLite or PostgreSQL
web/      React 19 + Vite + TypeScript single-page app
docs/     Product, architecture, security and user guide
```

## Known limits

- Word page count is an estimate; only `.docx` is accepted.
- Video metadata is removed only if `ffmpeg` is on the server PATH.
- PostgreSQL support is implemented but has been exercised mainly on SQLite.
- Microsoft 365 single sign-on is not included (email code or password).

Internal Lumovy Technology Solutions project.
