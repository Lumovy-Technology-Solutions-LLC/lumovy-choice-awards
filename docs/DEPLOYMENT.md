# Deployment on Azure (App Service)

The portal runs as **one Azure App Service (Linux, Node 22) web app** with **Azure Database for PostgreSQL Flexible Server**, deployed by **GitHub Actions**. The web app serves both the API and the built React site from the same address, so there is a single thing to deploy, monitor and scale.

```
Employees ──HTTPS──> App Service (Node 22)  ──> PostgreSQL Flexible Server
                         │  /home (persistent) = uploaded files
                         └──> SMTP (Microsoft 365 / SendGrid / ACS) for email
GitHub (main) ──Actions + OIDC──> build, test, deploy ──> App Service
```

| Piece | Choice | Why |
| --- | --- | --- |
| Hosting | App Service plan P1v3 (B2 for testing), Linux, Node 22 LTS | Managed, health checks, easy scale |
| Region | Central India | Employees are in India at launch |
| Database | PostgreSQL Flexible Server 16, Burstable B2s | Managed backups, point-in-time restore |
| Files | App Service persistent storage at `/home/data/uploads` | Shared across instances, no extra service for v1 |
| Email | SMTP (Microsoft 365, SendGrid or Azure Communication Services) | Works with the built-in mail queue |
| Secrets | App Settings (optionally Key Vault references) | No secrets in the repository |
| Deploy | GitHub Actions with Azure OIDC | No stored Azure passwords |
| Domain | Custom domain + free App Service managed certificate | HTTPS |

Match this to how World Cup Arena was set up if it differs (for example an existing resource group, plan, Key Vault or domain). The scripts below are plain Azure CLI so they are easy to adapt.

## Before you start

- An Azure subscription where you can create resources and app registrations, and GitHub admin on the repository.
- The public address you want (for example `https://choice.lumovy.com`) and DNS access.
- SMTP details for the sender address (with SPF and DKIM set up for the domain).
- The first HR admin's name and email.

## Step by step

### 1. Provision Azure (once)

Open **Azure Cloud Shell (bash)**, clone the repo (or upload `infra/provision.sh`), edit the variables at the top (subscription, names, SMTP, first admin, URL), then run:

```bash
bash infra/provision.sh
```

It creates the resource group, PostgreSQL server and database, App Service plan and web app, sets HTTPS-only, TLS 1.2, health check `/api/health`, Always On, all app settings, and a GitHub OIDC deployment identity. At the end it prints the values for step 2 and the first-admin sign-in. **Save the printed `APP_SECRET` and database password in your password manager or Key Vault.**

App settings it configures:

| Setting | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | public address (used in email links) |
| `APP_SECRET` | random 96 hex characters. Signs sessions, protects voter receipts. Do not change later |
| `DATABASE_URL` | PostgreSQL URL with `sslmode=require` |
| `UPLOAD_DIR`, `DATA_DIR` | `/home/data/uploads`, `/home/data` (persistent) |
| `MAIL_TRANSPORT`, `MAIL_FROM`, `SMTP_*` | `smtp` and your sender |
| `BOOTSTRAP_ADMIN_*` | first HR admin (remove the password after first sign-in) |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | `true` (keeps `/home` persistent) |

### 2. Connect GitHub

In the repository: **Settings > Environments > New environment** named `production` (add required reviewers if you want an approval step), then **Settings > Secrets and variables > Actions**:

- Secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (printed by the script)
- Variables: `AZURE_WEBAPP_NAME`, `AZURE_WEBAPP_HOSTNAME`

### 3. Deploy

Push to `main` (or run the workflow manually). `.github/workflows/deploy-azure.yml` will:

1. install, type-check and build the web app,
2. run the automated tests,
3. assemble a package (server with production dependencies and the built web app),
4. sign in to Azure with OIDC and deploy to the web app,
5. call `/api/health` as a smoke test.

On first start the app creates the database tables and the first HR admin automatically.

### 4. Custom domain and HTTPS

1. In DNS add a CNAME `choice` → `<app>.azurewebsites.net` and the TXT verification record shown in **App Service > Custom domains > Add custom domain**.
2. Add the domain, then **Add binding** with an **App Service Managed Certificate** (free).
3. Make sure `APP_URL` is the final `https://` address, then restart the app.

### 5. First sign-in and set-up

1. Open the address, sign in with the first admin email and the temporary password, then change it (account menu > Change password).
2. In **App Service > Environment variables**, delete `BOOTSTRAP_ADMIN_PASSWORD`, save and restart.
3. **Users & regions:** confirm India is switched on, **Import spreadsheet** (name, email, team, region) for all employees, add the other HR admins.
4. **Email test:** create a draft contest, open **Emails** and **Send test to me**. Check it arrives and its links open the right address.

### 6. Dry run before launch

1. Create a test contest with 3 entries, a near end time and 2-3 test employees (a staging slot or a separate staging app is ideal).
2. Start it, vote as the test employees, confirm the "Your vote is in" email.
3. Let it close, check the results, publish, confirm the results email.

PostgreSQL has been exercised mainly through SQLite so far, so this dry run on the real Azure database is required before the first real contest.

### 7. Go live

- [ ] HTTPS works on the custom domain, `APP_URL` matches
- [ ] SMTP sends real email and passes SPF/DKIM
- [ ] All employees imported with a region, India on
- [ ] HR admins added, bootstrap password removed
- [ ] Backups confirmed (below), a restore tested
- [ ] Dry run completed
- [ ] Announce, create the first contest, click **Start contest**

## Operations

- **Backups:** PostgreSQL Flexible Server takes automated backups with point-in-time restore (set retention to 14-35 days). Uploaded files are on `/home`; enable **App Service Backup** (App Service > Backups) so files and settings are protected too. Restore the database and files from the same point in time.
- **Monitoring:** turn on **Application Insights** (App Service > Application Insights), add an availability test on `/api/health`, and alerts on HTTP 5xx and response time. **Log stream** shows live logs.
- **Email problems:** failed emails show in **Admin > Email outbox**. Several app instances are safe: emails are claimed atomically.
- **Scaling:** scale **up** the plan (P1v3 → P2v3) for heavy days; scaling **out** to 2+ instances is supported because voting is decided by database constraints and `/home` is shared. Raise PostgreSQL to General Purpose if you see database CPU pressure in the last hour of a big contest.
- **Updates:** merge to `main`; the pipeline tests and deploys. Migrations run automatically on start. Avoid deploying in the last hour of a live contest (a restart takes seconds and loses no votes).
- **Staging:** create a second web app (or a deployment slot) with its own database for rehearsals. Point a second workflow at it.
- **Secrets hygiene:** rotate the SMTP and database passwords yearly. Keep `APP_SECRET` as it is; changing it makes existing voter receipts unreadable (votes and results are unaffected).

## Security on Azure

- HTTPS only, TLS 1.2+, FTPS disabled, managed certificate.
- PostgreSQL allows only Azure services; for stricter setups use a private endpoint and VNet integration, and Key Vault references for secrets.
- Optional: restrict access to the company network with App Service **Access restrictions**, or put Azure Front Door with WAF in front.
- Deployments use OIDC with a least-privilege role (Website Contributor on the resource group).

## Rollback

In GitHub **Actions**, re-run the last good deployment, or revert the commit on `main`. Do not roll the database back unless you restore a backup taken before the bad release.

## Estimated monthly cost (Central India, list prices, approximate)

| Item | Approx. |
| --- | --- |
| App Service P1v3 (B2 for testing is cheaper) | about 100-130 USD |
| PostgreSQL Flexible B2s + 32 GB storage | about 30-40 USD |
| Application Insights, backups, domain certificate | low, usage based |

Check the Azure pricing calculator for current numbers.
